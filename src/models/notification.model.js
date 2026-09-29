const mongoose = require('mongoose')

const NotificationSchema = new mongoose.Schema({
  role: String, text: String, at: String, read: { type: Boolean, default: false },
}, { collection: 'notifications', strict: false, versionKey: false })

module.exports = mongoose.model('Notification', NotificationSchema)
