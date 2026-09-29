/* Real-time fan-out middleware.
 * Every successful mutation (POST/PUT/DELETE) is broadcast to both apps on the
 * `data.changed` event; frontends listening refetch what they show, so the Hospital
 * App and the Admin App always mirror the same database live. */
const { getIo } = require('../sockets/socket')

function realtimeFanout(req, res, next) {
  if (req.method === 'GET' || req.method === 'OPTIONS') return next()
  const io = getIo()
  const send = res.json.bind(res)
  res.json = (body) => {
    if (res.statusCode < 400 && io) {
      const entity = req.path.split('/')[2] || 'data'
      const payload = { entity, method: req.method, path: req.path, at: new Date().toISOString() }
      io.emit('data.changed', payload)                                // both apps, every role
      if (req.user) io.to(req.user.role).emit('data.changed', payload) // role-room (idempotent)
    }
    return send(body)
  }
  next()
}

module.exports = { realtimeFanout }
