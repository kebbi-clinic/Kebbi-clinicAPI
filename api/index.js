/* Vercel serverless entry point (api/index.js).
 *
 * Vercel's Node runtime hands us a real (req, res) HTTP pair, so the Express
 * app can be driven directly — no http.createServer / fake-socket juggling.
 *
 * The important bit is ensureConnected(): a container is cold on its first
 * invocation and Mongoose has no connection yet. Every route issues queries
 * (StaffModel.findOne on login, etc.), so without awaiting the connection
 * first they are dispatched into Mongoose's command buffer and die with
 * "Operation `staff.findOne()` buffering timed out after 10000ms". The
 * connection is memoised in src/config/db.js, so only the first request of a
 * cold start pays the handshake cost; warm invocations return immediately. */
const app = require('../src/app')
const { ensureConnected } = require('../src/config/db')
const { assertProdEnv } = require('../src/config/env')

/* Fail fast on a bad production config (missing MONGODB_URI / JWT_SECRET)
 * instead of serving requests that would each 500. Checked at module scope so
 * the misconfiguration is obvious in the build logs. */
let bootError = null
try { assertProdEnv() } catch (err) { bootError = err; console.error('[vercel]', err.message) }

module.exports = async function handler(req, res) {
  if (bootError) {
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    return res.end(JSON.stringify({ error: 'Service misconfigured' }))
  }

  try {
    await ensureConnected()
  } catch (err) {
    /* Database unreachable. Answer 503 immediately rather than letting the
     * request hang until the platform kills the invocation. */
    console.error('[vercel] database unavailable:', err.code || err.message)
    if (!res.headersSent) {
      res.statusCode = 503
      res.setHeader('content-type', 'application/json')
    }
    return res.end(JSON.stringify({ error: 'Database unavailable, please retry' }))
  }

  return app(req, res)
}
