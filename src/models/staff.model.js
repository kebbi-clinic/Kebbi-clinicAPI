const mongoose = require('mongoose')

const StaffSchema = new mongoose.Schema({
  _id: String, id: { type: String, required: true, unique: true },
  firstName: String, surname: String, phone: String, email: String,
  username: { type: String, unique: true, sparse: true },
  passwordHash: String, role: String, status: String, app: String, lastActive: String,
  mustChangePassword: { type: Boolean, default: false },
  /* Per-account capability override. Empty/absent = role defaults apply (admins
     get full access). Non-empty = the account may ONLY perform these caps —
     used to give a Hospital Administrator exactly the pages/actions we choose. */
  caps: { type: [String], default: undefined },
}, { collection: 'staff', strict: false, versionKey: false })

module.exports = mongoose.model('Staff', StaffSchema)
