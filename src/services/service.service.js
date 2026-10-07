/* Service (procedure) service — the priced catalogue an admin maintains, plus
 * recording a procedure that was actually performed on a patient.
 *
 * Performing a service bills the patient: the amount is taken from their wallet
 * when it is settled through the wallet, otherwise a pending payment is raised
 * for the accountant. Every settlement writes a payment row, a wallet ledger
 * row and an activity entry, so nothing is ever "just recorded". */
const {
  ServiceModel, PatientModel, PaymentModel, WalletTxModel,
  ActivityModel, clean,
} = require('../models')
const { nextId, getSettings } = require('../config/db')
const { now } = require('../utils/datetime')
const { audit } = require('./audit.service')
const { notify } = require('./notification.service')
const { broadcastActivity, getIo } = require('../sockets/socket')

function notFound(msg) {
  const err = new Error(msg); err.status = 404; return err
}

/** `?all=1` includes retired services; otherwise only the active ones. */
async function list(includeInactive) {
  const filter = includeInactive ? {} : { active: { $ne: false } }
  const rows = await ServiceModel.find(filter).sort('name')
  return rows.map(clean)
}

async function create(body, actor) {
  const service = new ServiceModel({
    _id: await nextId('service'), id: '',
    name: body.name,
    category: body.category || 'Procedure',
    amount: Number(body.amount) || 0,
    department: body.department || 'General',
    notes: body.notes || '',
    active: body.active === undefined ? true : !!body.active,
    createdBy: actor.name, createdAt: now(),
  })
  service.id = service._id
  await service.save()
  await audit(actor.name, 'Created procedure/service', service.name, 'Administration', `₦${service.amount.toLocaleString()}`)
  await notify('Super Admin', `${actor.name} added the procedure/service "${service.name}" (₦${service.amount.toLocaleString()})`)
  const io = getIo()
  if (io) io.emit('services.changed', clean(service))
  return clean(service)
}

async function update(id, body, actor) {
  const service = await ServiceModel.findById(id)
  if (!service) throw notFound('Procedure/service not found')
  const before = service.amount
  if (body.name !== undefined) service.name = body.name
  if (body.category !== undefined) service.category = body.category
  if (body.department !== undefined) service.department = body.department
  if (body.notes !== undefined) service.notes = body.notes
  if (body.amount !== undefined) service.amount = Number(body.amount) || 0
  if (body.active !== undefined) service.active = !!body.active
  service.updatedAt = now()
  await service.save()
  if (before !== service.amount) {
    await audit(actor.name, 'Updated procedure/service price', service.name, 'Administration',
      `₦${Number(before).toLocaleString()} -> ₦${service.amount.toLocaleString()}`)
  } else {
    await audit(actor.name, 'Updated procedure/service', service.name, 'Administration')
  }
  const io = getIo()
  if (io) io.emit('services.changed', clean(service))
  return clean(service)
}

/* Record a procedure/service performed on a patient and bill for it. */
async function perform(body, actor) {
  const patient = await PatientModel.findById(body.patientId)
  if (!patient) throw notFound('Patient not found')
  const service = await ServiceModel.findById(body.serviceId)
  if (!service) throw notFound('Procedure/service not found')
  if (service.active === false) throw new Error(`"${service.name}" is no longer an active service`)

  const amount = Number(service.amount) || 0
  const settle = body.settle || 'Wallet'
  const entryId = await nextId('procedure')
  const at = now()

  /* Wallet settlement: debit immediately. Otherwise raise a pending payment for
     the accountant and leave the wallet untouched. */
  let chargedToWallet = false
  let balanceAfter = Number(patient.wallet) || 0
  if (settle === 'Wallet' && amount > 0) {
    if (balanceAfter < amount) {
      const err = new Error(
        `Insufficient wallet balance. "${service.name}" costs ₦${amount.toLocaleString()} but the patient has ₦${balanceAfter.toLocaleString()}. Fund the wallet first or settle by another method.`,
      )
      err.status = 400
      throw err
    }
    balanceAfter -= amount
    patient.wallet = balanceAfter
    await patient.save()
    chargedToWallet = true
  }

  patient.procedures.push({
    id: entryId, serviceId: service.id, name: service.name, amount,
    performedBy: actor.name, role: actor.role, at, notes: body.notes || '',
    chargedToWallet,
    paymentStatus: chargedToWallet ? 'Paid' : 'Pending',
  })
  await patient.save()


  if (amount > 0) {
    const pay = new PaymentModel({
      _id: await nextId('payment'), id: '', ref: '',
      patientId: patient.id, patientName: `${patient.firstName} ${patient.surname}`,
      amount, method: settle, service: `${service.name} (${entryId})`,
      staff: actor.name, at, status: chargedToWallet ? 'Paid' : 'Pending',
    })
    pay.id = pay._id
    await pay.save()
    if (chargedToWallet) {
      const wtxId = await nextId('wallet')
      await WalletTxModel.create({
        _id: wtxId, id: wtxId,
        patientId: patient.id, type: 'Debit', amount,
        reason: `${service.name} (${entryId})`, method: 'Wallet',
        staff: actor.name, at, balanceAfter,
      })
    } else {
      /* Outstanding: tell the accountant there is money to collect. */
      await notify('Accountant', `Payment pending: ${service.name} ₦${amount.toLocaleString()} for ${patient.firstName} ${patient.surname} (${patient.id}) — settle by ${settle}.`)
    }
  }

  const text = `${service.name} performed - ₦${amount.toLocaleString()}${chargedToWallet ? ' (wallet)' : ''}`
  await ActivityModel.create({
    patientId: patient.id, time: at, what: text,
    meta: `${actor.role} - ${actor.name}`, dept: actor.role, green: true,
  })
  broadcastActivity(
    { patientId: patient.id, time: at, what: text, meta: `${actor.role} - ${actor.name}`, dept: actor.role, green: true },
    undefined, actor.name,
  )
  await audit(actor.name, 'Recorded procedure/service', patient.id, actor.role,
    `${service.name} - ₦${amount.toLocaleString()}`)

  return { procedure: clean(patient.procedures[patient.procedures.length - 1]), walletBalance: balanceAfter }
}

/* Everything performed on a patient, newest first. */
async function listForPatient(patientId) {
  const patient = await PatientModel.findById(patientId)
  if (!patient) throw notFound('Patient not found')
  return [...(patient.procedures || [])].reverse().map(clean)
}

/**
 * Procedure / service inventory: the catalogue with how often each entry has
 * actually been performed and billed.
 *
 * `quantity` is the number of times the procedure appears on a patient's
 * permanent record; `amount` is the catalogue price; `total` is amount × quantity
 * (what the hospital has charged for it so far). Procedures that were performed
 * but whose catalogue entry has since been removed still report, keyed by name,
 * so historical billing never disappears from the accountant's view.
 *
 * Readable by every authenticated staff member — the accountant reads it for
 * revenue, doctors and nurses read it to see what they can record.
 */
async function inventory() {
  const [services, patients] = await Promise.all([
    ServiceModel.find().sort('name'),
    PatientModel.find({ 'procedures.0': { $exists: true } }).select('procedures'),
  ])

  const qty = new Map()     // key -> times performed
  const billed = new Map()  // key -> money actually charged
  for (const p of patients) {
    for (const pr of (p.procedures || [])) {
      const key = pr.serviceId || `name:${pr.name}`
      qty.set(key, (qty.get(key) || 0) + 1)
      billed.set(key, (billed.get(key) || 0) + (Number(pr.amount) || 0))
    }
  }

  const rows = []
  const seen = new Set()
  for (const s of services) {
    const key = s.id
    const quantity = qty.get(key) || 0
    seen.add(key)
    const amount = Number(s.amount) || 0
    rows.push({
      id: s.id, procedure: s.name, name: s.name, category: s.category,
      department: s.department, active: s.active !== false,
      amount, quantity, total: amount * quantity,
      billed: billed.get(key) || 0,
    })
  }
  /* Performed procedures whose catalogue entry was deleted or renamed. */
  for (const [key, quantity] of qty) {
    if (seen.has(key)) continue
    const name = key.startsWith('name:') ? key.slice(5) : key
    const billedAmount = billed.get(key) || 0
    rows.push({
      id: key, procedure: name, name, category: 'Archived', department: 'General',
      active: false, amount: quantity ? Math.round(billedAmount / quantity) : 0,
      quantity, total: billedAmount, billed: billedAmount,
    })
  }

  rows.sort((a, b) => a.procedure.localeCompare(b.procedure))
  return {
    items: rows,
    totals: {
      procedures: rows.length,
      quantity: rows.reduce((t, r) => t + r.quantity, 0),
      amount: rows.reduce((t, r) => t + r.amount, 0),
      total: rows.reduce((t, r) => t + r.total, 0),
      billed: rows.reduce((t, r) => t + r.billed, 0),
    },
  }
}

/* The activation fee charged to a patient's wallet when they are activated.
   Read from settings so the admin console controls it; 0 disables the charge. */
function activationFee() {
  return Number(getSettings()?.activationFee) || 0
}

module.exports = { list, create, update, perform, listForPatient, inventory, activationFee }