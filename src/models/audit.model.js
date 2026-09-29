const mongoose = require('mongoose')

const AuditSchema = new mongoose.Schema({
  who: String, action: String, target: String, extra: String, when: String, dept: String,
}, { collection: 'audit', strict: false, versionKey: false })

module.exports = mongoose.model('Audit', AuditSchema)
