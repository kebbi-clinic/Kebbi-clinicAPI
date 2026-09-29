/* Server bootstrap — connect DB, seed on first run, attach sockets, listen. */
const http = require('http')
const app = require('./app')
const { init } = require('./sockets/socket')
const { connect, loadSettings } = require('./config/db')
const { config, assertProdEnv } = require('./config/env')
const { StaffModel } = require('./models')
const { seed } = require('./seed/seed')

async function start() {
  assertProdEnv()
  await connect()

  const count = await StaffModel.countDocuments({})
  if (count === 0) {
    await seed()
    await loadSettings() // the seed creates the settings doc — refresh the cache
  }

  const server = http.createServer(app)
  init(server)

  /* Attach the error handler BEFORE listening, so a busy port exits cleanly
   * instead of crashing with a raw stack trace. */
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[server] Port ${config.port} is already in use — another backend instance is probably running.`)
      console.error('[server] Stop it with:  lsof -ti :4000 | xargs kill   (or change PORT in backend/.env)')
      process.exit(1)
    }
    throw err
  })

  server.listen(config.port, () => {
    console.log(`Kebbi Clinic backend running on http://localhost:${config.port} [${config.nodeEnv}]`)
    console.log(`CORS origins: ${config.corsOrigins.join(', ')}`)
    console.log(`Mailtrap email: ${config.mail.apiToken ? 'api token' : config.mail.user ? 'smtp' : 'not configured (logging to console)'}`)
  })

  const shutdown = (signal) => () => {
    console.log(`\n${signal} received — shutting down`)
    server.close(() => process.exit(0))
  }
  process.on('SIGINT', shutdown('SIGINT'))
  process.on('SIGTERM', shutdown('SIGTERM'))
}

start().catch((e) => { console.error(e); process.exit(1) })

module.exports = app
