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
    if (!origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) return cb(null, true)
    return cb(new Error(`Origin ${origin} not allowed by CORS`))
  },
}))
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
