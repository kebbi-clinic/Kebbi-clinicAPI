const mongoose = require('mongoose')

const ActivitySchema = new mongoose.Schema({
  patientId: String, time: String, what: String, meta: String, dept: String, green: Boolean,
}, { collection: 'activity', strict: false, versionKey: false })

module.exports = mongoose.model('Activity', ActivitySchema)
