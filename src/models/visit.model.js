const mongoose = require('mongoose')

const VisitSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  patientId: String, date: String, createdAt: String, type: String, status: String,
  diagnosis: String,
  consultation: { complaint: String, history: String, exam: String, diagnosis: String, doctor: String, at: String },
}, { collection: 'visits', strict: false, versionKey: false })

module.exports = mongoose.model('Visit', VisitSchema)
