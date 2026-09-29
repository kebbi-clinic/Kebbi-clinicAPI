/* MongoDB connection + ID counters + the settings document cache.
 * Falls back to an in-memory MongoDB when MONGODB_URI is unset (dev convenience). */
const mongoose = require('mongoose')
const dns = require('dns')
const { execFile } = require('child_process')
const { MongoMemoryServer } = require('mongodb-memory-server')
const path = require('path')
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
}

let SETTINGS = null // in-memory cache of the _settings doc (lives behind getSettings())

async function connect() {
  if (config.mongoUri) {
    /* Atlas SRV lookups can fail with certain DNS resolvers/VPNs — retry a few
     * times before giving up so a transient network hiccup doesn't kill boot. */
    let lastErr
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 })
        console.log('[db] connected to MongoDB Atlas')
        await loadSettings()
        return
      } catch (err) {
        lastErr = err
        console.warn(`[db] Atlas connection attempt ${attempt}/3 failed: ${err.code || err.message}`)
        /* SRV resolution broken by the local resolver? Retry with a fully
         * resolved multi-host mongodb:// URI instead. */
        if (config.mongoUri.startsWith('mongodb+srv://')) {
          try {
            const direct = await resolveSrvUri(config.mongoUri)
            await mongoose.connect(direct, { serverSelectionTimeoutMS: 10_000 })
            console.log('[db] connected to MongoDB Atlas (SRV bypassed — direct shard hosts)')
            await loadSettings()
            return
          } catch (err2) {
            lastErr = err2
            console.warn(`[db] SRV-bypass attempt ${attempt}/3 failed: ${err2.code || err2.message}`)
          }
        }
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000))
      }
    }
    console.error('[db] Could not reach MongoDB Atlas. Check MONGODB_URI and your network/VPN.')
    console.error('[db] Tip: clear MONGODB_URI in backend/.env to run on the in-memory database instead.')
    throw lastErr
  }
  const mem = await MongoMemoryServer.create()
  await mongoose.connect(mem.getUri())
  console.log('[db] connected to in-memory MongoDB (set MONGODB_URI for Atlas)')
  await loadSettings()
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
  const s = await SettingModel.findOne().lean()
  if (!s) { SETTINGS = null; return }
  SETTINGS = {
    hospital: s.hospital, investigationTypes: s.investigationTypes,
    drugCategories: s.drugCategories, paymentMethods: s.paymentMethods,
    rolePermissions: s.rolePermissions, counters: s.counters,
  }
}

function setSettings(s) { SETTINGS = s }
function getSettings() { return SETTINGS }

const uploadsDir = path.join(__dirname, '..', '..', 'data', 'uploads')

module.exports = { connect, nextId, loadSettings, setSettings, getSettings, uploadsDir, SettingModel, CounterModel }
