const mongoose = require('mongoose')

const PatientSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  firstName: String, surname: String, otherName: String, dob: String, gender: String,
  phone: String, address: String, email: String,
  nextOfKin: { name: String, relationship: String, phone: String, address: String },
  status: String, registered: String, registeredAt: String, wallet: Number, bloodGroup: String,
  /* Set by the Records Officer when the patient is activated — drives the
     "new patients" queue on the nurses' dashboard. */
  activatedAt: String, activatedBy: String,
  /* Procedures / services performed on this patient, each billed to the wallet. */
  procedures: [{
    id: String, serviceId: String, name: String, amount: Number,
    performedBy: String, role: String, at: String, notes: String,
    chargedToWallet: Boolean, paymentStatus: String,
  }],
}, { collection: 'patients', strict: false, versionKey: false })

module.exports = mongoose.model('Patient', PatientSchema)
