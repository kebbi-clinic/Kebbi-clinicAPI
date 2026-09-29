/* Socket.IO real-time hub — live updates for both frontend apps.
 * Connections that present the login JWT are identity-tracked, which gives
 * admins a live "who is online" presence view.
 *
 * Runs in two modes:
 *  • Local (src/server.js): init(httpServer) attaches the hub to a real server.
 *  • Vercel (api/index.js): the hub is built without an http server and the
 *    lambda proxy injects each /socket.io/ upgrade request via io.handleUpgrade.
 * When REDIS_URL is set, the Redis adapter fans broadcasts across instances
 * and presence moves to Redis (required on serverless — each connection is
 * pinned to a different function instance). */
const jwt = require('jsonwebtoken')
const { config } = require('../config/env')

/* staffId -> { id, name, role, app, since, sockets } — presence in local mode. */
const online = new Map()
let io = null

/* ── Redis (optional): cross-instance broadcast + shared presence ─────── */
const PRESENCE_KEY = 'kc:presence'
const PRESENCE_TTL = 90 /* seconds — refreshed by the 25s heartbeat below */
let redis = null

async function connectRedis() {
  if (!config.redisUrl) return null
  const { createClient } = require('redis')
  const client = createClient({ url: config.redisUrl })
  client.on('error', (e) => console.warn('[socket] redis error:', e.message))
  await client.connect()
  return client
}

async function presenceAdd(entry) {
  if (redis) {
    await redis.hSet(PRESENCE_KEY, entry.id, JSON.stringify(entry))
    await redis.expire(PRESENCE_KEY, PRESENCE_TTL)
    return
  }
  online.set(entry.id, entry)
}

async function presenceBump(staffId) {
  if (redis) {
    const raw = await redis.hGet(PRESENCE_KEY, staffId)
    if (!raw) return null
    const entry = JSON.parse(raw)
    entry.sockets += 1
    await redis.hSet(PRESENCE_KEY, staffId, JSON.stringify(entry))
    await redis.expire(PRESENCE_KEY, PRESENCE_TTL)
    return entry
  }
  const seen = online.get(staffId)
  if (seen) { seen.sockets += 1; return seen }
  return null
}

async function presenceHeartbeat(staffId) {
  if (!redis) return
  const raw = await redis.hGet(PRESENCE_KEY, staffId)
  if (raw) {
    await redis.hSet(PRESENCE_KEY, staffId, raw)
    await redis.expire(PRESENCE_KEY, PRESENCE_TTL)
  }
}

/* Returns the remaining socket count after decrementing (presence entry
 * deleted automatically at zero). */
async function presenceRemove(staffId) {
  if (redis) {
    const raw = await redis.hGet(PRESENCE_KEY, staffId)
    if (!raw) return 0
    const entry = JSON.parse(raw)
    entry.sockets -= 1
    if (entry.sockets <= 0) { await redis.hDel(PRESENCE_KEY, staffId); return 0 }
    await redis.hSet(PRESENCE_KEY, staffId, JSON.stringify(entry))
    return entry.sockets
  }
  const seen = online.get(staffId)
  if (!seen) return 0
  seen.sockets -= 1
  if (seen.sockets <= 0) { online.delete(staffId); return 0 }
  return seen.sockets
}
/* ── helpers ──────────────────────────────────────────────────────────── */
function verifyToken(token) {
  if (!token) return null
  try { return jwt.verify(token, config.jwtSecret) } catch { return null }
}

const ADMIN_ROOMS = ['Super Admin', 'Hospital Administrator']

function announce(user, isUp) {
  if (!io) return
  const evt = { online: isUp, user: { id: user.id, name: user.name, role: user.role, app: user.app, since: user.since } }
  for (const room of ADMIN_ROOMS) io.to(room).emit('presence', evt)
}

/** Snapshot of currently-connected staff (admin "who is online" view).
 *  Resolves the Redis presence hash when Redis mode is on (serverless). */
async function onlineUsers() {
  if (redis) {
    const all = await redis.hVals(PRESENCE_KEY)
    return all.map((v) => JSON.parse(v)).sort((a, b) => (a.since < b.since ? -1 : 1))
  }
  return [...online.values()].sort((a, b) => (a.since < b.since ? -1 : 1))
}

/* Build the io hub. In serverless mode there is no http server — the Vercel
 * lambda proxy injects /socket.io/ requests via io.handleUpgrade() (see
 * api/index.js). Safe to call twice: returns the existing hub. */
async function attach() {
  if (io) return io
  const { Server } = require('socket.io')
  io = new Server({
    cors: { origin: config.corsOrigins.length ? config.corsOrigins : '*', methods: ['GET', 'POST'] },
    serveClient: false,
    pingInterval: 25000,
  })

  if (config.redisUrl) {
    try {
      redis = await connectRedis()
      const { createAdapter } = require('@socket.io/redis-adapter')
      const pub = redis.duplicate()
      const sub = redis.duplicate()
      await Promise.all([pub.connect(), sub.connect()])
      io.adapter(createAdapter(pub, sub))
      console.log('[socket] redis adapter + shared presence enabled')
    } catch (e) {
      console.warn('[socket] redis unavailable — single-instance mode:', e.message)
      redis = null
    }
  }

  io.on('connection', (socket) => {
    /* Identity via the login JWT sent in the handshake — auto-joins the role
       room and marks the staff member online for admins. */
    const user = verifyToken(socket.handshake.auth?.token || socket.handshake.query?.token)
    if (user) {
      socket.data.user = user
      socket.join(user.role)
      handleOnline(user).catch(() => {})
      /* Keep the Redis presence entry fresh for this connection's lifetime. */
      socket.data.beat = setInterval(() => { presenceHeartbeat(user.id).catch(() => {}) }, 25000)
    }
    /* Client joins its role-room so events can be targeted by role. */
    socket.on('subscribe', (role) => { socket.join(role); socket.data.role = role })
    socket.on('joinUser', (userId) => { socket.join(`user:${userId}`) })
    socket.on('disconnect', () => {
      const u = socket.data.user
      if (!u) return
      clearInterval(socket.data.beat)
      handleOffline(u).catch(() => {})
    })
  })
  console.log('[socket] io ready')
  return io
}

async function handleOnline(user) {
  const bumped = await presenceBump(user.id)
  if (bumped) { announce(bumped, true); return } /* already seen — socket count refreshed */
  const entry = { id: user.id, name: user.name, role: user.role, app: user.app, since: new Date().toISOString(), sockets: 1 }
  await presenceAdd(entry)
  announce(entry, true)
  /* Refresh last-active so the Staff list reflects real presence. */
  const { StaffModel } = require('../models')
  StaffModel.updateOne({ id: user.id }, { lastActive: new Date().toISOString() }).catch(() => {})
}

async function handleOffline(u) {
  const left = await presenceRemove(u.id)
  if (left === 0) announce(u, false)
}

/* Warm the hub at module load (fire-and-forget) so lambdas build io during
 * the init phase; emits fired before it is ready are skipped like before. */
attach().catch((e) => console.warn('[socket] attach failed:', e.message))

/** Build + attach the hub to a local HTTP server (dev mode, src/server.js). */
async function init(server) {
  await attach()
  io.attach(server)
  return io
}

/** Current io instance (null before init). */
function getIo() { return io }

/** Emit a typed event to a role-room, optionally also echoing to the originating user. */
function emit(role, event, payload, toUser) {
  if (!io) return
  io.to(role).emit(event, payload)
  if (toUser) io.to(`user:${toUser}`).emit(event, payload)
}

/** Convenience: broadcast activity + push a role notification in real time. */
function broadcastActivity({ patientId, time, what, meta, dept, green }, targetRole, actor) {
  if (!io) return
  const evt = { patientId, time, what, meta, dept, green }
  /* Staff in the same dept + admins see the event in real time. */
  io.to(dept).emit('activity.new', evt)
  io.to('Super Admin').emit('activity.new', evt)
  io.to('Hospital Administrator').emit('activity.new', evt)
  /* Targeted notification to the relevant role. */
  if (targetRole && targetRole !== actor) {
    const text = `${dept}: ${what}`
    const notif = { role: targetRole, text, at: time, read: false }
    io.to(targetRole).emit('notification', notif)
    io.to('Super Admin').emit('notification', notif)
    /* Same alert out-of-browser via Web Push (fire-and-forget). */
    require('../services/push.service').pushToRoles([targetRole, 'Super Admin', 'Hospital Administrator'], { title: `Kebbi Clinic — ${targetRole}`, body: text, url: '/dashboard' })
  }
}

module.exports = { init, emit, broadcastActivity, getIo, onlineUsers, get io() { return io } }
