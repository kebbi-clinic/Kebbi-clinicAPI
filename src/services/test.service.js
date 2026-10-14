/* Laboratory & radiology test catalogue — inventory and prices, just like the
 * pharmacy drug list. The admin edits a price here (e.g. PCV = ₦2,000); it is
 * stamped onto each request when a doctor raises one, and the CURRENT price is
 * re-read and billed from the patient's wallet at result upload. */
const { TestModel, clean } = require('../models')
const { nextId } = require('../config/db')
const { now } = require('../utils/datetime')
const { audit } = require('./audit.service')
const { notify } = require('./notification.service')
const { priceFor } = require('./settings.service')

const DEPTS = ['Lab', 'Radiology']
const normaliseDept = (d) => (String(d || '').toLowerCase().startsWith('rad') ? 'Radiology' : 'Lab')

async function list(dept) {
  const filter = dept ? { dept: normaliseDept(dept) } : {}
  const rows = await TestModel.find(filter).sort('name')
  return rows.map(clean)
}

/* Current price of a test: an explicit amount wins (legacy callers), then the
 * catalogue entry (dept-aware, case-insensitive), then the settings overrides /
 * built-in defaults. Falls back to `fallback` — used to keep a previously
 * stamped price when the catalogue has no entry at all. */
async function resolvePrice(test, dept, { explicit, fallback = 0 } = {}) {
  if (explicit !== undefined && explicit !== null && explicit !== '') return Number(explicit) || 0
  const rows = await TestModel.find({ active: { $ne: false } })
  const wanted = String(test || '').trim().toLowerCase()
  const matches = rows.filter((r) => String(r.name || '').trim().toLowerCase() === wanted)
  const row = matches.find((r) => normaliseDept(r.dept) === normaliseDept(dept)) || matches[0]
  if (row) return Number(row.price) || 0
  return priceFor(test) || fallback
}

async function create(body, actor) {
  const test = new TestModel()
  test._id = await nextId('test'); test.id = test._id
  test.name = body.name
  test.dept = normaliseDept(body.dept)
  test.category = body.category || 'General'
  test.unit = body.unit || 'Test'
  test.price = Number(body.price) || 0
  test.stock = Number(body.stock) || 0
  test.minStock = Number(body.minStock) || 0
  test.active = body.active === undefined ? true : !!body.active
  test.createdBy = actor.name
  test.createdAt = now()
  await test.save()
  await audit(actor.name, 'Added test to inventory', test.name, test.dept === 'Radiology' ? 'Radiology' : 'Laboratory',
    `Price ₦${test.price.toLocaleString()}`)
  return clean(test)
}

async function update(id, body, actor) {
  const test = await TestModel.findById(id)
  if (!test) {
    const err = new Error('Test not found'); err.status = 404; throw err
  }
  if (body.name) test.name = body.name
  if (body.dept) test.dept = normaliseDept(body.dept)
  if (body.category) test.category = body.category
  if (body.unit) test.unit = body.unit
  if (body.active !== undefined) test.active = !!body.active
  if (body.stock !== undefined) test.stock = Number(body.stock) || 0
  if (body.minStock !== undefined) test.minStock = Number(body.minStock) || 0
  if (body.price !== undefined) {
    const old = Number(test.price) || 0
    test.price = Number(body.price) || 0
    await audit(actor.name, 'Updated test price', test.name, test.dept === 'Radiology' ? 'Radiology' : 'Laboratory',
      `Price: ₦${old.toLocaleString()} -> ₦${test.price.toLocaleString()}`)
    await notify('Super Admin', `${actor.name} changed the price of ${test.name} to ₦${test.price.toLocaleString()} — applied on the next result upload.`)
  }
  test.updatedAt = now()
  await test.save()
  return clean(test)
}

async function remove(id, actor) {
  const test = await TestModel.findById(id)
  if (!test) {
    const err = new Error('Test not found'); err.status = 404; throw err
  }
  await test.deleteOne()
  await audit(actor.name, 'Deleted test from inventory', test.name, test.dept === 'Radiology' ? 'Radiology' : 'Laboratory',
    `Former price ₦${Number(test.price || 0).toLocaleString()}`)
  await notify('Super Admin', `${actor.name} deleted the test "${test.name}" from the catalogue.`)
  return { id: test.id, deleted: true, name: test.name }
}

module.exports = { list, create, update, remove, resolvePrice, normaliseDept }