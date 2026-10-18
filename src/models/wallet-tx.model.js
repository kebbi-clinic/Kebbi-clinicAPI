const mongoose = require('mongoose')

const WalletTxSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  patientId: String,
  /* Receipt facts, denormalised at write time so every wallet transaction can
     print a receipt (hospital name comes from settings) without a lookup. */
  patientName: String, patientSex: String,
  type: String, amount: Number, reason: String, method: String,
  staff: String, staffRole: String, at: String, balanceAfter: Number,
}, { collection: 'walletTxs', strict: false, versionKey: false })

module.exports = mongoose.model('WalletTx', WalletTxSchema)
