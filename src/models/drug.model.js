const mongoose = require('mongoose')

const DrugSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  name: String, category: String, unit: String, stock: Number, minStock: Number, price: Number, expiry: String,
}, { collection: 'drugs', strict: false, versionKey: false })

module.exports = mongoose.model('Drug', DrugSchema)
