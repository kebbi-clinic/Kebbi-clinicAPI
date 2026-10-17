/* Settings service — the single hospital configuration document. */
const { SettingModel } = require('../models')
const { getSettings, setSettings, loadSettings, freshSettings } = require('../config/db')
const { DEFAULT_ROLE_PERMISSIONS, RX_ROUTES, RX_FREQUENCIES, DEFAULT_INVESTIGATION_PRICES } = require('../constants')
const { now } = require('../utils/datetime')
const { audit } = require('./audit.service')
const { notify } = require('./notification.service')

/* The catalogue both frontends read. `rxRoutes` / `rxFrequencies` are the fixed
   clinical vocabulary for prescriptions, so the server and both apps always
   offer exactly the same dropdown options.
 *
   `investigationPrices` is the effective price list: administrator overrides win,
   then the built-in defaults, so a brand-new test is priced the moment it is
   added rather than silently billed at ₦0. */
async function get() {
  /* What the activation-fee notice and the admin console show must be the
     stored document, not a possibly-stale per-instance copy — a stale read
     here is what made the app announce ₦0 while activation still charged
     ₦2,000. The cache is only a fallback when the database cannot be reached. */
  let s = null
  try {
    await loadSettings()
    s = getSettings()
  } catch (e) {
    console.warn('[settings] fresh read failed, using cache:', e.message)
    s = getSettings()
  }
  if (!s) return s
  return {
    ...s,
    rxRoutes: RX_ROUTES, rxFrequencies: RX_FREQUENCIES,
    investigationPrices: { ...DEFAULT_INVESTIGATION_PRICES, ...(s.investigationPrices || {}) },
  }
}

/* The fee an activation actually charges. Money must always follow the stored
   document — a stale cache on this instance must never decide the amount. */
async function currentActivationFee() {
  let s = null
  try {
    s = await freshSettings()
  } catch (e) {
    console.warn('[settings] fresh fee read failed:', e.message)
    s = getSettings()
  }
  return Number(s?.activationFee) || 0
}

/** Price of one investigation, preferring the request's own stored price. */
function priceFor(test, explicit) {
  if (explicit !== undefined && explicit !== null && explicit !== '') return Number(explicit) || 0
  const map = { ...DEFAULT_INVESTIGATION_PRICES, ...(getSettings()?.investigationPrices || {}) }
  return Number(map[String(test || '').trim()]) || 0
}

async function update(body, actor) {
  const existing = await SettingModel.findOne()
  const updated = {
    hospital: body.hospital || existing?.hospital,
    investigationTypes: body.investigationTypes || existing?.investigationTypes || [],
    drugCategories: body.drugCategories || existing?.drugCategories || [],
    paymentMethods: body.paymentMethods || existing?.paymentMethods || [],
    rolePermissions: body.rolePermissions || existing?.rolePermissions || DEFAULT_ROLE_PERMISSIONS,
    counters: body.counters || existing?.counters || {},
    /* Money settings — an omitted value keeps the current one so a partial
       save from the admin console can never silently zero them. */
    activationFee: body.activationFee !== undefined ? Number(body.activationFee) || 0 : (existing?.activationFee ?? 0),
    defaultNightlyRate: body.defaultNightlyRate !== undefined ? Number(body.defaultNightlyRate) || 0 : (existing?.defaultNightlyRate ?? 0),
    /* Per-test prices. Kept unless the caller actually sends a map, so the admin
       app (which does not know this field yet) can never wipe them. */
    investigationPrices: (body.investigationPrices && typeof body.investigationPrices === 'object' && !Array.isArray(body.investigationPrices))
      ? body.investigationPrices
      : (existing?.investigationPrices || {}),
    schemaVersion: existing?.schemaVersion || 0,
  }
  /* Atomic replace (upsert) instead of delete-one + create: under concurrent
     saves on serverless the old two-step dance could leave TWO settings
     documents behind, after which findOne() returned an arbitrary one and the
     fee flickered between values on different requests. Any historic
     duplicates are purged as well. */
  const kept = await SettingModel.findOneAndUpdate({}, updated, {
    upsert: true, returnDocument: 'after', setDefaultsOnInsert: false,
  })
  await SettingModel.deleteMany({ _id: { $ne: kept._id } })
  setSettings(updated)
  await loadSettings()
  await audit(actor.name, 'Updated settings', '', 'Administration')
  await notify('Super Admin', `System settings updated by ${actor.name}`)
  return {
    ok: true, activationFee: updated.activationFee,
    defaultNightlyRate: updated.defaultNightlyRate,
    investigationPrices: { ...DEFAULT_INVESTIGATION_PRICES, ...updated.investigationPrices },
  }
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

module.exports = { get, update, updatePermissions, priceFor, currentActivationFee }
