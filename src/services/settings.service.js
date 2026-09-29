/* Settings service — the single hospital configuration document. */
const { SettingModel } = require('../models')
const { getSettings, setSettings, loadSettings } = require('../config/db')
const { DEFAULT_ROLE_PERMISSIONS } = require('../constants')
const { now } = require('../utils/datetime')
const { audit } = require('./audit.service')
const { notify } = require('./notification.service')

function get() { return getSettings() }

async function update(body, actor) {
  const existing = await SettingModel.findOne()
  const updated = {
    hospital: body.hospital || existing?.hospital,
    investigationTypes: body.investigationTypes || existing?.investigationTypes || [],
    drugCategories: body.drugCategories || existing?.drugCategories || [],
    paymentMethods: body.paymentMethods || existing?.paymentMethods || [],
    rolePermissions: body.rolePermissions || existing?.rolePermissions || DEFAULT_ROLE_PERMISSIONS,
    counters: body.counters || existing?.counters || {},
  }
  await SettingModel.deleteOne({})
  await SettingModel.create(updated)
  setSettings(updated)
  await loadSettings()
  await audit(actor.name, 'Updated settings', '', 'Administration')
  await notify('Super Admin', `System settings updated by ${actor.name}`)
  return { ok: true }
}

async function updatePermissions(matrix, actor) {
  const settings = await SettingModel.findOne()
  if (!settings) {
    const err = new Error('Settings not found'); err.status = 404; throw err
  }
  settings.rolePermissions = matrix
  await settings.save()
  setSettings({ ...getSettings(), rolePermissions: matrix })
  await notify('Super Admin', `Role permissions updated by ${actor.name}`)
  await audit(actor.name, 'Updated role permissions', '', 'Administration')
  return { ok: true, matrix, at: now() }
}

module.exports = { get, update, updatePermissions }
