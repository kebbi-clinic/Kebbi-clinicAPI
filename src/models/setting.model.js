const mongoose = require('mongoose')

const SettingSchema = new mongoose.Schema({
  hospital: { type: Object, default: {} },
  investigationTypes: [{ type: String }],
  drugCategories: [{ type: String }],
  paymentMethods: [{ type: String }],
  rolePermissions: { type: Object, default: {} },
  counters: { type: Object, default: {} },
  /* Charged to the patient's wallet the moment a Records Officer activates
     them. 0 disables the charge. Configurable in the admin console. */
  activationFee: { type: Number, default: 0 },
  /* Default nightly bed charge used to pre-fill a new admission. */
  defaultNightlyRate: { type: Number, default: 0 },
  /* Test name -> price (₦). Consultation stamps this onto each investigation so
     the laboratory knows what to take from the patient's wallet when the result
     is submitted. Falls back to DEFAULT_INVESTIGATION_PRICES for new tests. */
  investigationPrices: { type: Object, default: {} },
  /* Bumped whenever new settings/permission fields are introduced, so the
     one-time upgrade in config/db.js runs exactly once on existing databases. */
  schemaVersion: { type: Number, default: 0 },
}, { collection: '_settings' })

const SettingModel = mongoose.model('_Setting', SettingSchema)

const CounterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } })
const CounterModel = mongoose.model('_Counter', CounterSchema)

module.exports = { SettingModel, CounterModel }
