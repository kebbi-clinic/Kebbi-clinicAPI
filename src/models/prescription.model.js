const mongoose = require('mongoose')

const PrescriptionSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  patientId: String, patientName: String, doctor: String, visitId: String, createdAt: String,
  items: [{ drugId: String, drug: String, qty: Number, price: Number }],
  status: String,
}, { collection: 'prescriptions', strict: false, versionKey: false })

module.exports = mongoose.model('Prescription', PrescriptionSchema)
