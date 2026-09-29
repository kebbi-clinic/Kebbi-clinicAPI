const mongoose = require('mongoose')

const InvestigationSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  patientId: String, visitId: String, dept: String, test: String, doctor: String, createdAt: String,
  status: String, price: Number,
  result: { image: String, values: String, at: String, by: String },
}, { collection: 'investigations', strict: false, versionKey: false })

module.exports = mongoose.model('Investigation', InvestigationSchema)
