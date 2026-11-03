/* Pharmacy service — prescription dispensing & inventory, with wallet billing,
 * payment records, wallet ledger and low-stock email alerts (Mailtrap). */
const { PatientModel, PrescriptionModel, PaymentModel, WalletTxModel, DrugModel,
        ActivityModel, InvestigationModel, OTCSaleModel, clean } = require('../models')
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

/* ---- Over-the-counter (cash) drug sales to non-patients ----------------- */

async function createOTCSale({ items, customerName, customerPhone }, actor) {
  if (!Array.isArray(items) || !items.length) {
    const err = new Error('Add at least one drug to the sale'); err.status = 422; throw err
  }
  const customer = String(customerName || '').trim()
  if (!customer) {
    const err = new Error('Customer name is required'); err.status = 422; throw err
  }

  const drugs = await DrugModel.find()
  const lineItems = []
  let total = 0
  for (const it of items) {
    const drug = drugs.find((d) => d.id === it.drugId)
    if (!drug) {
      const err = new Error(`Unknown drug ${it.drugId}`); err.status = 422; throw err
    }
    const qty = Number(it.qty) || 0
    if (qty < 1) {
      const err = new Error(`Quantity for ${drug.name} must be at least 1`); err.status = 422; throw err
    }
    lineItems.push({ drugId: drug.id, drug: drug.name, qty, price: Number(drug.price) || 0 })
    total += Number(drug.price || 0) * qty
  }

  /* A Pending sale is just a held cart: nothing is debited, no stock moves
   * yet, and no patient is required — the customer pays the accountant later.
   * The sale id (e.g. OTC-000001) is the reference the customer carries. */
  const id = await nextId('otc')
  const at = now()
  const sale = new OTCSaleModel({
    _id: id, id,
    customerName: customer,
    customerPhone: String(customerPhone || '').trim(),
    items: lineItems, total,
    status: 'Pending',
    createdBy: actor.name, createdByRole: actor.role || '', createdAt: at,
  })
  sale.id = sale._id
  await sale.save()
  await audit(actor.name, 'Created over-the-counter sale', customer, 'Pharmacy', `${id} — ₦${total.toLocaleString()}`)
  return clean(sale)
}

async function markOTCSalePaid(saleId, { paymentMethod }, actor) {
  const sale = await OTCSaleModel.findOne({ id: saleId })
  if (!sale) {
    const err = new Error('Sale not found'); err.status = 404; throw err
  }
  if (sale.status !== 'Pending') {
    const err = new Error(`Sale ${saleId} is already ${sale.status.toLowerCase()}`); err.status = 409; throw err
  }

  const methods = getSettings()?.paymentMethods || ['Wallet', 'Cash', 'Transfer', 'POS']
  if (!methods.includes(paymentMethod)) {
    const err = new Error(`Payment method must be one of: ${methods.join(', ')}`); err.status = 422; throw err
  }

  /* Stock only leaves the shelf once the accountant marks the sale Paid — a
   * Pending sale is a held cart, so an unpaid customer never burns stock. */
  const drugs = await DrugModel.find()
  for (const it of sale.items) {
    const drug = drugs.find((d) => d.id === it.drugId)
    if (!drug) {
      const err = new Error(`Drug ${it.drug} is no longer available`); err.status = 422; throw err
    }
    if ((drug.stock || 0) < it.qty) {
      const err = new Error(`Insufficient stock for ${it.drug} (need ${it.qty}, have ${drug.stock || 0})`); err.status = 402; throw err
    }
  }

  const at = now()
  for (const it of sale.items) {
    const drug = drugs.find((d) => d.id === it.drugId)
    drug.stock = (drug.stock || 0) - it.qty
    await drug.save()
  }

  const pay = new PaymentModel({
    _id: await nextId('payment'), id: '', ref: '',
    patientId: sale.id, patientName: sale.customerName, patientSex: '',
    amount: sale.total, method: paymentMethod,
    service: `Over-the-counter drug sale ${sale.id}`,
    staff: actor.name, staffRole: actor.role || '',
    txId: '', at, status: 'Paid',
  })
  pay.id = pay._id
  await pay.save()

  sale.status = 'Paid'
  sale.paymentMethod = paymentMethod
  sale.paidAt = at
  sale.paidBy = actor.name
  sale.paidByRole = actor.role || ''
  sale.paymentId = pay.id
  await sale.save()

  await ActivityModel.create({
    patientId: sale.id, time: at,
    what: `Over-the-counter sale paid — ₦${sale.total.toLocaleString()}`,
    meta: `Accounting - ${actor.name}`, dept: 'Accounting', green: true,
  })
  broadcastActivity({
    patientId: sale.id, time: at,
    what: `Over-the-counter sale paid — ₦${sale.total.toLocaleString()}`,
    meta: `Accounting - ${actor.name}`, dept: 'Accounting', green: true,
  }, undefined, actor.name)
  await audit(actor.name, 'Marked over-the-counter sale paid', sale.id, 'Accounting', `${sale.id} — ₦${sale.total.toLocaleString()} (${paymentMethod})`)

  return { sale: clean(sale), payment: clean(pay) }
}

async function listOTCSales() {
  const rows = await OTCSaleModel.find().sort('-createdAt').lean()
  return rows.map(clean)
}

async function getOTCSale(id) {
  const sale = await OTCSaleModel.findOne({ id })
  if (!sale) {
    const err = new Error('Sale not found'); err.status = 404; throw err
  }
  return clean(sale)
}

module.exports = { listPrescriptions, dispense, listDrugs, createDrug, updateDrug,
  createOTCSale, markOTCSalePaid, listOTCSales, getOTCSale }
