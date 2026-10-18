const mongoose = require('mongoose')

const PaymentSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  ref: String, patientId: String, patientName: String, patientSex: String,
  amount: Number, method: String,
  service: String, staff: String, staffRole: String,
  /* Points at the wallet ledger row this payment produced, so the receipt can
     show the debit/credit side. Absent on legacy rows. */
  txId: String,
  at: String, status: String,
}, { collection: 'payments', strict: false, versionKey: false })

module.exports = mongoose.model('Payment', PaymentSchema)
