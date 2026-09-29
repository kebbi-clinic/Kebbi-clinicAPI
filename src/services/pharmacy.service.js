/* Pharmacy service — prescription dispensing & inventory, with wallet billing,
 * payment records, wallet ledger and low-stock email alerts (Mailtrap). */
const { PatientModel, PrescriptionModel, PaymentModel, WalletTxModel, DrugModel,
        ActivityModel, InvestigationModel, clean } = require('../models')
const { nextId } = require('../config/db')
const { now } = require('../utils/datetime')
const { audit } = require('./audit.service')
const { notify } = require('./notification.service')
const { broadcastActivity } = require('../sockets/socket')
const emailService = require('./email.service')

async function listPrescriptions(patientId) {
  const filter = patientId ? { patientId } : {}
  const rows = await PrescriptionModel.find(filter).sort('-createdAt')
  return rows.map(clean)
}

async function dispense(id, body, actor) {
  const rx = await PrescriptionModel.findById(id)
  if (!rx) {
    const err = new Error('Prescription not found'); err.status = 404; throw err
  }
  rx.status = 'Dispensed'
  await rx.save()
  const patient = await PatientModel.findById(rx.patientId)
  const total = rx.items.reduce((s, x) => s + x.price * x.qty, 0)

  let pay
  if (patient.wallet >= total) {
    patient.wallet -= total
    await patient.save()
    pay = new PaymentModel({
      _id: await nextId('payment'), id: '',
      ref: '', patientId: patient.id, patientName: `${patient.firstName} ${patient.surname}`,
      amount: total, method: 'Wallet', service: `Dispensed ${rx.id}`, staff: actor.name, at: now(), status: 'Paid',
    })
    pay.id = pay._id
    await pay.save()
    const wtxId = await nextId('wallet')
    await WalletTxModel.create({
      _id: wtxId, id: wtxId,
      patientId: patient.id, type: 'Debit', amount: total, reason: `Dispensed ${rx.id}`, method: 'Wallet', staff: actor.name, at: now(), balanceAfter: patient.wallet,
    })
  } else {
    pay = new PaymentModel({
      _id: await nextId('payment'), id: '',
      ref: '', patientId: patient.id, patientName: `${patient.firstName} ${patient.surname}`,
      amount: total, method: body.method || 'Cash', service: `Dispensed ${rx.id} - pending payment`, staff: 'System', at: now(), status: 'Pending',
    })
    pay.id = pay._id
    await pay.save()
  }

  const text = `Prescription dispensed - ₦${total.toLocaleString()}`
  await ActivityModel.create({ patientId: rx.patientId, time: now(), what: text, meta: `Pharmacy - ${actor.name}`, dept: 'Pharmacy', green: true })
  broadcastActivity({ patientId: rx.patientId, time: now(), what: text, meta: `Pharmacy - ${actor.name}`, dept: 'Pharmacy', green: true }, undefined, actor.name)
  await audit(actor.name, 'Dispensed prescription', rx.patientId, 'Pharmacy', `${rx.id} - ₦${total.toLocaleString()}`)
  await notify('Doctor', `Prescription ${rx.id} dispensed for ${patient.firstName} ${patient.surname} (${patient.id})`)

  /* Email the receipt when the patient provided an email address. */
  if (patient.email) {
    emailService.sendEmail({
      to: patient.email,
      subject: `Kebbi Clinic receipt — ${rx.id}`,
      title: 'Payment receipt',
      bodyHtml: `<p>Dear ${patient.firstName},</p><p>Prescription <b>${rx.id}</b> has been dispensed.</p>
        <p><b>Total:</b> ₦${total.toLocaleString()}<br/><b>Method:</b> ${pay.method}<br/><b>Status:</b> ${pay.status}</p>`,
    })
  }
  return { prescription: clean(rx), payment: clean(pay), total, walletBalance: patient.wallet }
}

/* ---- Inventory ---- */
async function listDrugs() {
  const rows = await DrugModel.find().sort('name')
  return rows.map(clean)
}

async function createDrug(body, actor) {
  const drug = new DrugModel()
  drug._id = await nextId('drug'); drug.id = drug._id
  drug.name = body.name; drug.category = body.category || 'Analgesic'; drug.unit = body.unit || 'Tablet'
  drug.stock = Number(body.stock) || 0; drug.minStock = Number(body.minStock) || 0
  drug.price = Number(body.price); drug.expiry = body.expiry || ''
  await drug.save()
  await audit(actor.name, 'Added drug to inventory', drug.name, 'Pharmacy')
  return clean(drug)
}

async function updateDrug(id, body, actor) {
  const drug = await DrugModel.findById(id)
  if (!drug) {
    const err = new Error('Drug not found'); err.status = 404; throw err
  }
  if (body.name) drug.name = body.name
  if (body.category) drug.category = body.category
  if (body.unit) drug.unit = body.unit
  if (body.expiry) drug.expiry = body.expiry
  if (body.price !== undefined) {
    const old = drug.price; drug.price = Number(body.price)
    await audit(actor.name, 'Updated drug', drug.name, 'Pharmacy', `Price: ₦${old} -> ₦${drug.price}`)
  }
  if (body.stock !== undefined) drug.stock = Number(body.stock)
  if (body.minStock !== undefined) drug.minStock = Number(body.minStock)
  await drug.save()
  return clean(drug)
}

module.exports = { listPrescriptions, dispense, listDrugs, createDrug, updateDrug }
