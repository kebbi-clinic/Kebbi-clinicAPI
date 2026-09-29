/* Notification service — persists role-targeted notifications, pushes them live
 * over Socket.IO AND delivers a Web Push so the alert is heard even when the tab
 * is closed. Admins always receive every notification (matches the bell panel). */
const { NotificationModel } = require('../models')
const { now } = require('../utils/datetime')
const { getIo } = require('../sockets/socket')
const { pushToRoles } = require('./push.service')

async function notify(role, text) {
  const at = now()
  await NotificationModel.create({ role, text, at })
  const io = getIo()
  const payload = { role, text, at, read: false }
  if (io) {
    io.to(role).emit('notification', payload)
    io.to('Super Admin').emit('notification', payload)
    io.to('Hospital Administrator').emit('notification', payload)
  }
  const roles = [role, 'Super Admin', 'Hospital Administrator']
  pushToRoles(roles, { title: `Kebbi Clinic — ${role}`, body: text, url: '/dashboard' })
}

module.exports = { notify }
