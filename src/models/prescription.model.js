const mongoose = require('mongoose')

const PrescriptionSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  patientId: String, patientName: String, doctor: String, visitId: String, createdAt: String,
  /* Each line: drug, route (IV/IM/Oral/Rectal), frequency (Daily/BD/TDS/…),
     duration in days, qty, and the live unit price from pharmacy inventory. */
  items: [{
    drugId: String, drug: String, route: String, frequency: String,
    duration: Number, qty: Number, price: Number,
  }],
  status: String, dispensedBy: String, dispensedAt: String,
}, { collection: 'prescriptions', strict: false, versionKey: false })

module.exports = mongoose.model('Prescription', PrescriptionSchema)
