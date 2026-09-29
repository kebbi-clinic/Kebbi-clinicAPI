const mongoose = require('mongoose')

const WalletTxSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  patientId: String, type: String, amount: Number, reason: String, method: String,
  staff: String, at: String, balanceAfter: Number,
}, { collection: 'walletTxs', strict: false, versionKey: false })

module.exports = mongoose.model('WalletTx', WalletTxSchema)
