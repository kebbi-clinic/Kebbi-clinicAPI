/* Procedure / service catalogue — created by the admin, priced, and performed
 * by nurses & doctors. A performed service is billed to the patient's wallet. */
const mongoose = require('mongoose')

const ServiceSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  category: { type: String, default: 'Procedure' },
  amount: { type: Number, default: 0 },
  /* Department expected to perform it — used to group it in the pickers. */
  department: { type: String, default: 'General' },
  notes: String,
  active: { type: Boolean, default: true },
  createdBy: String, createdAt: String, updatedAt: String,
}, { collection: 'services', strict: false, versionKey: false })

module.exports = mongoose.model('Service', ServiceSchema)