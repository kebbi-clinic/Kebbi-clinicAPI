/* Express application assembly — no listening here, see server.js. */
const express = require('express')
const cors = require('cors')
const { config } = require('./config/env')
const { uploadsDir } = require('./config/db')
const { realtimeFanout } = require('./middleware/realtime.middleware')
const { notFound, errorHandler } = require('./middleware/error.middleware')
const apiRoutes = require('./routes')

const app = express()
app.disable('x-powered-by')

/* CORS — only the apps we own. */
app.use(cors({
  origin(origin, cb) {
    if (config.isAllowedOrigin(origin)) return cb(null, true)
    return cb(new Error(`Origin ${origin} not allowed by CORS`))
  },
}))
/* API responses must never be cached by the browser or any CDN in between.
   Without this header the browser stores the first response (including its
   CORS headers) and reuses it on subsequent requests — which is exactly how a
   stale `Access-Control-Allow-Origin` from an old deployment survives a code
   fix and keeps blocking the dashboard. `no-store` forces every request to
   hit the server so the current CORS policy always applies. */
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})
app.use(express.json({ limit: '2mb' }))

/* Static result-file serving (local-storage fallback). */
app.use('/api/uploads', express.static(uploadsDir))

/* Live data fan-out, then the API. */
app.use(realtimeFanout)
app.use('/api', apiRoutes)

/* 404 + central error handler. */
app.use(notFound)
app.use(errorHandler)

module.exports = app
