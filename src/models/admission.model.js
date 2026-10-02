const mongoose = require('mongoose')

const AdmissionSchema = new mongoose.Schema({
  _id: { type: String, required: true }, id: { type: String, required: true, unique: true },
  patientId: String, patientName: String, visitId: String, ward: String, bed: String,
  doctor: String, at: String, reason: String, status: String,
  /* Bed charge: number of nights admitted × cost per night = total billed. */
  days: { type: Number, default: 1 },
  costPerNight: { type: Number, default: 0 },
  totalCost: { type: Number, default: 0 },
  /* Set when the bed charge was taken from the wallet, false when it is still
     outstanding and the accountant has to collect it. */
  chargedToWallet: { type: Boolean, default: false },
  dischargedAt: String,
  discharge: { date: String, diagnosis: String, summary: String, notes: String, staff: String },
}, { collection: 'admissions', strict: false, versionKey: false })

module.exports = mongoose.model('Admission', AdmissionSchema)
