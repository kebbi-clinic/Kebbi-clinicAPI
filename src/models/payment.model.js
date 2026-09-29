const mongoose = require('mongoose')

const PaymentSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  ref: String, patientId: String, patientName: String, amount: Number, method: String,
  service: String, staff: String, at: String, status: String,
}, { collection: 'payments', strict: false, versionKey: false })

module.exports = mongoose.model('Payment', PaymentSchema)
