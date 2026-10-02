/* MongoDB connection + ID counters + the settings document cache.
 * Falls back to an in-memory MongoDB when MONGODB_URI is unset (dev convenience). */
const mongoose = require('mongoose')
const dns = require('dns')
const { execFile } = require('child_process')
const path = require('path')
/* mongodb-memory-server is required lazily inside openConnection() — it pulls a
 * ~100MB mongod binary, so it must stay out of the serverless bundle. */
const { config } = require('./env')
const { SettingModel, CounterModel } = require('../models/setting.model')

/* Some DNS resolvers/VPNs return malformed answers for SRV lookups, which makes
 * the MongoDB driver's `mongodb+srv://` bootstrapping fail (EBADRESP). When that
 * happens we resolve the shard hosts ourselves (via a public DNS resolver as a
 * fallback) and build a plain multi-host `mongodb://` URI. */
/* Resolve SRV via the system `dig` utility (uses the OS resolver). */
function srvViaDig(srvName) {
  return new Promise((resolve) => {
    execFile('dig', ['+short', '-t', 'SRV', srvName], { timeout: 8000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null)
      const records = stdout.trim().split('\n').map((line) => {
        const parts = line.trim().split(/\s+/)
        return { priority: Number(parts[0]), weight: Number(parts[1]), port: Number(parts[2]), name: parts[3].replace(/\.$/, '') }
      }).filter((r) => r.name)
      resolve(records.length ? records : null)
    })
  })
}

/* Resolve SRV via `nslookup` (macOS/BSD fallback, also uses the OS resolver). */
function srvViaNslookup(srvName) {
  return new Promise((resolve) => {
    execFile('nslookup', ['-type=SRV', srvName], { timeout: 8000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null)
      const records = [...stdout.matchAll(/=\s*\d+\s+\d+\s+(\d+)\s+([^\s.]+[^\s]*)/g)]
        .map((m) => ({ priority: 0, weight: 0, port: Number(m[1]), name: m[2].replace(/\.$/, '') }))
        .filter((r) => r.name)
      resolve(records.length ? records : null)
    })
  })
}

async function resolveSrvUri(uri) {
  const m = uri.match(/^mongodb\+srv:\/\/(?:([^@]+)@)?([^/?]+)(\/[^?]*)?(\?.*)?$/)
  if (!m) throw new Error('MONGODB_URI is not a valid mongodb+srv:// string')
  const [, auth, clusterHost, dbPath = '/', query = ''] = m
  const srvName = `_mongodb._tcp.${clusterHost}`

  let records
  try {
    records = await dns.promises.resolveSrv(srvName)
  } catch {
    /* Node's resolver chokes on some SRV replies — fall back to the OS resolver
     * (dig, then nslookup), which handles the same query correctly. */
    records = await srvViaDig(srvName) || await srvViaNslookup(srvName)
    if (!records) throw new Error(`Could not resolve SRV records for ${srvName} (dig/nslookup failed)`)
  }
  const hosts = records.map((r) => `${r.name}:${r.port || 27017}`).join(',')

  /* TXT record carries authSource & replicaSet for Atlas clusters. */
  let txtParams = ''
  try {
    const txt = await dns.promises.resolveTxt(clusterHost)
    const flat = txt.flat().join('&')
    if (flat) txtParams = flat
  } catch { /* best effort */ }

  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)
  for (const [k, v] of new URLSearchParams(txtParams)) params.set(k, v)
  params.set('tls', 'true')

  return `mongodb://${auth ? auth + '@' : ''}${hosts}${dbPath || '/'}?${params.toString()}`
}

const COUNTERS = {
  patient: 'KBC', visit: 'VIS', vital: 'VIT', investigation: 'INV',
  radiology: 'RDG', prescription: 'RX', admission: 'ADM', payment: 'PAY',
  wallet: 'WTX', drug: 'DRG', staff: 'STF',
  service: 'SVC', procedure: 'PRC',
}

/* Bump when new settings fields or capabilities are introduced. Databases with a
 * lower schemaVersion are upgraded once at boot (see upgradeSettings) so an
 * already-seeded install picks up the new capabilities instead of silently
 * denying every request that needs them. */
const SETTINGS_SCHEMA_VERSION = 2

/* One-time upgrade of the stored settings document:
 *  · add the capabilities introduced since the database was seeded, keeping any
 *    capability an administrator has deliberately edited,
 *  · add the new activationFee / defaultNightlyRate fields. */
async function upgradeSettings(doc) {
  const { DEFAULT_ROLE_PERMISSIONS, CAPS } = require('../constants')
  const matrix = { ...DEFAULT_ROLE_PERMISSIONS, ...(doc.rolePermissions || {}) }
  for (const role of Object.keys(matrix)) {
    const entry = matrix[role] || {}
    const can = Array.isArray(entry.can) ? entry.can.filter((c) => CAPS[c]) : []
    const cannot = Array.isArray(entry.cannot) ? entry.cannot.filter((c) => CAPS[c]) : []
    const defaults = DEFAULT_ROLE_PERMISSIONS[role]?.can || []
    /* Union so a capability the role is entitled to by default is never lost,
       while `cannot` keeps winning in can(). */
    matrix[role] = { can: [...new Set([...defaults, ...can])], cannot: [...new Set(cannot)] }
  }
  doc.rolePermissions = matrix
  if (doc.activationFee === undefined || doc.activationFee === null) doc.activationFee = 0
  if (doc.defaultNightlyRate === undefined || doc.defaultNightlyRate === null) doc.defaultNightlyRate = 0
  doc.schemaVersion = SETTINGS_SCHEMA_VERSION
  await doc.save()
  console.log('[db] settings upgraded to schema version', SETTINGS_SCHEMA_VERSION)
}

let SETTINGS = null // in-memory cache of the _settings doc (lives behind getSettings())

/* Connection options. `bufferCommands: false` is the important one: it stops
 * Mongoose from parking a query in a buffer for 10s when the connection is not
 * up yet, so a cold/down database surfaces as an immediate error the caller can
 * turn into a 503 instead of a hung request. Combined with the await in
 * api/index.js this is safe — no query ever runs before we are connected. */
const CONNECT_OPTS = {
  bufferCommands: false,
  maxPoolSize: 10,
}

/* Running as a Vercel function (a single request occupying one invocation) is a
 * very different budget from a long-running local server. A boot-time 3x retry
 * with 2s sleeps can burn ~34s — fine when you're about to listen anyway, fatal
 * on a serverless request that will be killed first. Detect it via the
 * Vercel-provided env vars so we fail fast and let the next invocation retry. */
const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT)

/* Attempt count + how long we're willing to hunt for a reachable server. */
const ATTEMPTS = isServerless ? 1 : 3
const SERVER_SELECTION_MS = isServerless ? 5_000 : 10_000
const RETRY_DELAY_MS = 2_000

const connectOpts = () => ({ ...CONNECT_OPTS, serverSelectionTimeoutMS: SERVER_SELECTION_MS })

/* The in-flight (or resolved) connection promise. A serverless cold start runs
 * several requests concurrently against one container; without this memo each
 * one would open its own pool and thrash Atlas' connection limit. Cleared on
 * failure so the NEXT invocation retries instead of replaying a dead handle. */
let connectionPromise = null

/* An unhandled 'error' on the connection is a fatal uncaught exception in Node
 * and takes the whole lambda invocation down. Swallow + log; the next request
 * re-runs ensureConnected(). */
mongoose.connection.on('error', (err) => {
  console.error('[db] connection error:', err.code || err.message)
})

async function openConnection() {
  if (config.mongoUri) {
    /* Atlas SRV lookups can fail with certain DNS resolvers/VPNs — retry a few
     * times before giving up so a transient network hiccup doesn't kill boot. */
    let lastErr
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        await mongoose.connect(config.mongoUri, connectOpts())
        console.log('[db] connected to MongoDB Atlas')
        await loadSettings()
        return
      } catch (err) {
        lastErr = err
        console.warn(`[db] Atlas connection attempt ${attempt}/${ATTEMPTS} failed: ${err.code || err.message}`)
        /* SRV resolution broken by the local resolver? Retry with a fully
         * resolved multi-host mongodb:// URI instead. */
        if (config.mongoUri.startsWith('mongodb+srv://')) {
          try {
            const direct = await resolveSrvUri(config.mongoUri)
            await mongoose.connect(direct, connectOpts())
            console.log('[db] connected to MongoDB Atlas (SRV bypassed — direct shard hosts)')
            await loadSettings()
            return
          } catch (err2) {
            lastErr = err2
            console.warn(`[db] SRV-bypass attempt ${attempt}/${ATTEMPTS} failed: ${err2.code || err2.message}`)
          }
        }
        if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
      }
    }
    console.error('[db] Could not reach MongoDB Atlas. Check MONGODB_URI and your network/VPN.')
    console.error('[db] Tip: clear MONGODB_URI in backend/.env to run on the in-memory database instead.')
    throw lastErr
  }
  /* Dev-only fallback. Lazy require keeps the mongod binary out of the bundle. */
  const { MongoMemoryServer } = require('mongodb-memory-server')
  const mem = await MongoMemoryServer.create()
  await mongoose.connect(mem.getUri(), connectOpts())
  console.log('[db] connected to in-memory MongoDB (set MONGODB_URI for Atlas)')
  await loadSettings()
}

/* Connect once, memoised. Reused by src/server.js at boot and by the Vercel
 * function on every request. */
function connect() {
  if (!connectionPromise) {
    connectionPromise = openConnection().catch((err) => {
      /* Drop the rejected memo so a later request (or the next cold start)
       * gets a genuine retry instead of replaying this failure forever. */
      connectionPromise = null
      throw err
    })
  }
  return connectionPromise
}

/** Guard called at the top of every serverless request. Returns immediately
 *  once the pool is live, and re-opens it if Atlas dropped us while the
 *  container was idle (readyState !== 1). */
function ensureConnected() {
  if (mongoose.connection.readyState === 1) return Promise.resolve()
  return connect()
}

async function nextId(key, pad = 6) {
  const prefix = COUNTERS[key]
  const doc = await CounterModel.findOneAndUpdate(
    { _id: key }, { $inc: { seq: 1 } },
    { upsert: true, new: true, runValidators: false },
  )
  return prefix + '-' + String(doc.seq).padStart(pad, '0')
}

async function loadSettings() {
  let s = await SettingModel.findOne()
  /* Upgrade an existing database in place before caching it. */
  if (s && (s.schemaVersion || 0) < SETTINGS_SCHEMA_VERSION) {
    try { await upgradeSettings(s) } catch (e) { console.warn('[db] settings upgrade failed:', e.message) }
  }
  if (!s) { SETTINGS = null; return }
  s = await SettingModel.findOne()
  SETTINGS = {
    hospital: s.hospital, investigationTypes: s.investigationTypes,
    drugCategories: s.drugCategories, paymentMethods: s.paymentMethods,
    rolePermissions: s.rolePermissions, counters: s.counters,
    activationFee: s.activationFee || 0,
    defaultNightlyRate: s.defaultNightlyRate || 0,
  }
}

function setSettings(s) { SETTINGS = s }
function getSettings() { return SETTINGS }

const uploadsDir = path.join(__dirname, '..', '..', 'data', 'uploads')

module.exports = { connect, ensureConnected, nextId, loadSettings, setSettings, getSettings, uploadsDir, SettingModel, CounterModel }
