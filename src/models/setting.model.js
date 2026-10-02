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
  /* Bumped whenever new settings/permission fields are introduced, so the
     one-time upgrade in config/db.js runs exactly once on existing databases. */
  schemaVersion: { type: Number, default: 0 },
}, { collection: '_settings' })

const SettingModel = mongoose.model('_Setting', SettingSchema)

const CounterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } })
const CounterModel = mongoose.model('_Counter', CounterSchema)

module.exports = { SettingModel, CounterModel }
