/* Central error handling + 404 for the API. */
const multer = require('multer')
const { config } = require('../config/env')

function notFound(_req, res) {
  res.status(404).json({ error: 'Endpoint not found' })
}

/* eslint-disable-next-line no-unused-vars */
function errorHandler(err, _req, res, _next) {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message })
  if (res.headersSent) return
  if (config.isProd) console.error('[error]', err)
  res.status(err.status || 500).json({ error: err.message || 'Internal error' })
}

module.exports = { notFound, errorHandler }
