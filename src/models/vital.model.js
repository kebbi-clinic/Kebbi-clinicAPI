const mongoose = require('mongoose')

const VitalSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  patientId: String, visitId: String, staff: String, temp: String, bp: String, pulse: String,
  resp: String, spo2: String, weight: String, at: String,
}, { collection: 'vitals', strict: false, versionKey: false })

module.exports = mongoose.model('Vital', VitalSchema)
