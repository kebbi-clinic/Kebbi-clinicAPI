const mongoose = require('mongoose')

/* Over-the-counter (cash) drug sale to a walk-in customer who is NOT a
 * registered patient. The pharmacist rings up the sale as "Pending" and hands
 * the customer the sale id (e.g. OTC-000001). The customer pays the
 * accountant, who marks the sale "Paid" with a payment method (Cash, Transfer,
 * POS) — only then is stock deducted and the receipt released. */
const OTCSaleSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  customerName: { type: String, required: true },
  customerPhone: String,
  items: [{ drugId: String, drug: String, qty: Number, price: Number }],
  total: { type: Number, required: true },
  status: { type: String, required: true, default: 'Pending' }, // Pending | Paid | Cancelled
  paymentMethod: String,
  paidAt: String, paidBy: String, paidByRole: String,
  createdBy: String, createdByRole: String, createdAt: String,
  paymentId: String,
}, { collection: 'otcSales', strict: false, versionKey: false })

module.exports = mongoose.model('OTCSale', OTCSaleSchema)
