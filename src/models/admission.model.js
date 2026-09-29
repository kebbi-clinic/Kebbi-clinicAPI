const mongoose = require('mongoose')

const AdmissionSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  patientId: String, patientName: String, visitId: String, ward: String, bed: String,
  doctor: String, at: String, reason: String, status: String,
  discharge: { date: String, diagnosis: String, summary: String, notes: String, staff: String },
}, { collection: 'admissions', strict: false, versionKey: false })

module.exports = mongoose.model('Admission', AdmissionSchema)
