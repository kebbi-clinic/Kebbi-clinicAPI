const mongoose = require('mongoose')

const SettingSchema = new mongoose.Schema({
  hospital: { type: Object, default: {} },
  investigationTypes: [{ type: String }],
  drugCategories: [{ type: String }],
  paymentMethods: [{ type: String }],
  rolePermissions: { type: Object, default: {} },
  counters: { type: Object, default: {} },
}, { collection: '_settings' })

const SettingModel = mongoose.model('_Setting', SettingSchema)

const CounterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } })
const CounterModel = mongoose.model('_Counter', CounterSchema)

module.exports = { SettingModel, CounterModel }
