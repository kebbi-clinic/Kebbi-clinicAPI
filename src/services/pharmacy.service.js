/* Pharmacy service — prescription dispensing & inventory, with wallet billing,
 * payment records, wallet ledger and low-stock email alerts (Mailtrap). */
const { PatientModel, PrescriptionModel, PaymentModel, WalletTxModel, DrugModel,
        ActivityModel, InvestigationModel, clean } = require('../models')
const { nextId } = require('../config/db')
const { now, byNewest } = require('../utils/datetime')
const { insufficientWalletError } = require('../utils/wallet')
const { audit } = require('./audit.service')
const { notify } = require('./notification.service')
const { broadcastActivity } = require('../sockets/socket')
const emailService = require('./email.service')

async function listPrescriptions(patientId) {
  const filter = patientId ? { patientId } : {}
  const rows = await PrescriptionModel.find(filter).lean()
  /* LATEST FIRST — real timestamp order, not a string compare. */
  return [...rows].sort(byNewest('createdAt'))
}

async function dispense(id, body, actor) {
  const rx = await PrescriptionModel.findById(id)
  if (!rx) {
    const err = new Error('Prescription not found'); err.status = 404; throw err
  }
  if (rx.status === 'Dispensed') {
    const err = new Error(`${rx.id} has already been dispensed`); err.status = 409; throw err
  }
  const patient = await PatientModel.findById(rx.patientId)
  if (!patient) {
    const err = new Error('Patient not found'); err.status = 404; throw err
  }
  const items = rx.items || []
  const total = items.reduce((s, x) => s + (Number(x.price) || 0) * (Number(x.qty) || 0), 0)

  /* The pharmacist may dispense a subset of the lines; only the dispensed lines
     are billed. Falls back to the whole prescription when no selection is sent. */
  const selected = Array.isArray(body.items) && body.items.length ? body.items : null
  const picked = (it) => !selected || selected.some((s) => s.drugId === it.drugId)
  const billedItems = items.filter(picked)
  const billedTotal = billedItems.reduce((s, x) => s + (Number(x.price) || 0) * (Number(x.qty) || 0), 0)

  /* HARD WALLET GUARD: nothing is dispensed, NO stock moves and no payment is
     written unless the wallet covers the bill in full. A short wallet refuses
     the whole transaction and tells the pharmacist to top up the wallet first —
     no partial debit and no "pending" remainder. */
  const balance = Number(patient.wallet) || 0
  if (billedTotal > balance) {
    throw insufficientWalletError(patient, billedTotal, `prescription ${rx.id}`)
  }

  /* Stock comes off the shelf for every line actually handed over. */
  const drugs = await DrugModel.find()
  const shortages = []
  for (const it of billedItems) {
    const drug = drugs.find((d) => d.id === it.drugId)
    if (!drug) continue
    if (drug.stock < it.qty) shortages.push(`${drug.name} (need ${it.qty}, in stock ${drug.stock})`)
    else { drug.stock -= Number(it.qty) || 0; await drug.save() }
  }

  rx.status = 'Dispensed'
  rx.dispensedBy = actor.name
  rx.dispensedAt = now()
  await rx.save()

  /* The cost comes off the wallet in full — the guard above proves it fits. The
     wallet ledger row is written first so the payment can point at its receipt. */
  const shortfall = 0
  const debited = billedTotal
  let wtx = null
  if (debited > 0) {
    patient.wallet = balance - debited
    await patient.save()
    const wtxId = await nextId('wallet')
    wtx = await WalletTxModel.create({
      _id: wtxId, id: wtxId,
      patientId: patient.id,
      patientName: `${patient.firstName} ${patient.surname}`,
      patientSex: patient.gender || '',
      type: 'Debit', amount: debited,
      reason: `Dispensed ${rx.id}`, method: 'Wallet',
      staff: actor.name, staffRole: actor.role || '', at: now(), balanceAfter: patient.wallet,
    })
  }

  const pay = new PaymentModel({
    _id: await nextId('payment'), id: '',
    ref: '', patientId: patient.id, patientName: `${patient.firstName} ${patient.surname}`,
    patientSex: patient.gender || '',
    amount: billedTotal, method: 'Wallet',
    service: `Dispensed ${rx.id}`,
    staff: actor.name, staffRole: actor.role || '',
    txId: wtx ? wtx.id : '',
    at: now(),
    status: 'Paid',
  })
  pay.id = pay._id
  await pay.save()

  const text = `Prescription dispensed - ₦${billedTotal.toLocaleString()}`
  await ActivityModel.create({ patientId: rx.patientId, time: now(), what: text, meta: `Pharmacy - ${actor.name}`, dept: 'Pharmacy', green: true })
  broadcastActivity({ patientId: rx.patientId, time: now(), what: text, meta: `Pharmacy - ${actor.name}`, dept: 'Pharmacy', green: true }, undefined, actor.name)
  await audit(actor.name, 'Dispensed prescription', rx.patientId, 'Pharmacy', `${rx.id} - ₦${billedTotal.toLocaleString()}`)
  await notify('Doctor', `Prescription ${rx.id} dispensed for ${patient.firstName} ${patient.surname} (${patient.id})`)

  /* Email the receipt when the patient provided an email address. */
  if (patient.email) {
    emailService.sendEmail({
      to: patient.email,
      subject: `Kebbi Clinic receipt — ${rx.id}`,
      title: 'Payment receipt',
      bodyHtml: `<p>Dear ${patient.firstName},</p><p>Prescription <b>${rx.id}</b> has been dispensed.</p>
        <p><b>Total:</b> ₦${billedTotal.toLocaleString()}<br/><b>Taken from wallet:</b> ₦${debited.toLocaleString()}<br/>
        <b>Outstanding:</b> ₦${shortfall.toLocaleString()}<br/><b>Wallet balance:</b> ₦${patient.wallet.toLocaleString()}</p>`,
    })
  }
  return {
    prescription: clean(rx), payment: clean(pay),
    total: billedTotal, prescriptionTotal: total,
    debitedFromWallet: debited, outstanding: shortfall,
    walletBalance: patient.wallet,
    walletTx: wtx ? clean(wtx) : null,
    shortages,
  }
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
