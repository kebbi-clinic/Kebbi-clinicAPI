/* Laboratory & radiology test catalogue — the "inventory" of investigations,
 * mirroring the pharmacy drug list. The admin sets the price of each test here
 * (e.g. PCV = ₦2,000); the amount is stamped onto a request when a doctor raises
 * it and re-read at result upload, which is the billable moment. */
const mongoose = require('mongoose')

const TestSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  /* 'Lab' or 'Radiology' — same values the investigation records use. */
  dept: { type: String, default: 'Lab' },
  category: { type: String, default: 'General' },
  unit: { type: String, default: 'Test' },
  price: { type: Number, default: 0 },
  /* Consumable stock (kits/reagents). Zero means "no stock tracking". */
  stock: { type: Number, default: 0 },
  minStock: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  createdBy: String, createdAt: String, updatedAt: String,
}, { collection: 'testCatalogue', strict: false, versionKey: false })

module.exports = mongoose.model('Test', TestSchema)