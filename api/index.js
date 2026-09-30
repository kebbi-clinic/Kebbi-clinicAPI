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
const { assertProdEnv, config } = require('../src/config/env')

/* Error responses are written here instead of by Express, so they bypass the
 * app's CORS middleware. Without these headers a browser reports a missing
 * Access-Control-Allow-Origin header and shows what is really a 500/503 as
 * "blocked by CORS policy" — hiding the actual server fault. Answering
 * preflights here keeps the real status visible in devtools. */
function isAllowedOrigin(origin) {
  return !origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)
}

function fail(res, req, status, message) {
  if (res.headersSent) return res.end()
  const origin = req.headers && req.headers.origin
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('content-type', 'application/json')

  /* A preflight must succeed for the browser to send the real request at all;
   * if it fails, the user only ever sees the CORS error. Reply 204 so the
   * actual POST follows and surfaces the genuine status code. */
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', (req.headers && req.headers['access-control-request-headers']) || 'content-type')
    res.setHeader('Access-Control-Max-Age', '600')
    return res.end()
  }

  res.statusCode = status
  return res.end(JSON.stringify({ error: message }))
}

/* Fail fast on a bad production config (missing MONGODB_URI / JWT_SECRET)
 * instead of serving requests that would each 500. Checked at module scope so
 * the misconfiguration is obvious in the build logs. */
let bootError = null
try { assertProdEnv() } catch (err) { bootError = err; console.error('[vercel]', err.message) }

/* Express routes on the full path ("/api/auth/login"), but Vercel's rewrite
 * may hand the function the destination path ("/api") instead of the original.
 * Vercel preserves what was actually requested in x-vercel-original-url (and
 * x-invoke-path on some runtimes), so prefer that when it is present and let
 * Express see the route the client asked for. */
function restoreOriginalUrl(req) {
  const original = req.headers['x-vercel-original-url'] || req.headers['x-invoke-path']
  if (original && typeof original === 'string' && original.startsWith('/api/')) {
    req.url = original + (req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')
  }
  /* Nothing to restore, and no /api prefix (e.g. a bare "/" request): mount the
   * app so its own /api routes still resolve instead of 404-ing at the edge. */
  else if (req.url === '/' || req.url === '') {
    req.url = '/api'
  }
}

module.exports = async function handler(req, res) {
  restoreOriginalUrl(req)

  if (bootError) return fail(res, req, 500, 'Service misconfigured')

  try {
    await ensureConnected()
  } catch (err) {
    /* Database unreachable. Answer 503 immediately rather than letting the
     * request hang until the platform kills the invocation. */
    console.error('[vercel] database unavailable:', err.code || err.message)
    return fail(res, req, 503, 'Database unavailable, please retry')
  }

  return app(req, res)
}
