const mongoose = require('mongoose')

const PatientSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  firstName: String, surname: String, otherName: String, dob: String, gender: String,
  phone: String, address: String, email: String,
  nextOfKin: { name: String, relationship: String, phone: String, address: String },
  status: String, registered: String, registeredAt: String, wallet: Number, bloodGroup: String,
}, { collection: 'patients', strict: false, versionKey: false })

module.exports = mongoose.model('Patient', PatientSchema)
