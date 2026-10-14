/* Laboratory & Radiology service — request queue and result upload.
 *
 * Submitting a result is the billable moment: the test's price — the admin's
 * current catalogue price, re-read right here — is taken from the patient's
 * wallet. What the wallet cannot cover is raised as a pending payment so the
 * accountant still has a record — the result is never blocked and the money is
 * never lost. A result may be a photo/scan OR typed values (either is enough). */
const { InvestigationModel, PatientModel, PaymentModel, WalletTxModel,
        ActivityModel, clean } = require('../models')
const { nextId } = require('../config/db')
const { now, byNewest } = require('../utils/datetime')
const { audit } = require('./audit.service')
const { broadcastActivity } = require('../sockets/socket')
const { notify } = require('./notification.service')
const { uploadResult } = require('../services/storage.service')
const { resolvePrice } = require('./test.service')
const emailService = require('./email.service')

async function list(dept) {
  const filter = dept ? { dept: dept === 'Radiology' ? 'Radiology' : 'Lab' } : {}
  const rows = await InvestigationModel.find(filter).lean()
  /* LATEST FIRST — a real timestamp sort, so a request filed at 02:30 pm sits
     above one from 10:20 am (a plain string sort would get that wrong). */
  return [...rows].sort(byNewest('createdAt'))
}

/* Take the test fee from the patient's wallet. Returns the money facts for the
 * response so the laboratory screen can show exactly what moved. */
async function charge(patientId, inv, actor, at) {
  const price = Number(inv.price) || 0
  if (price <= 0) return { price: 0, debitedFromWallet: 0, outstanding: 0, walletBalance: null }

  const patient = await PatientModel.findById(patientId)
  if (!patient) return { price, debitedFromWallet: 0, outstanding: price, walletBalance: null }

  const balance = Number(patient.wallet) || 0
  const debited = Math.min(balance, price)
  const shortfall = price - debited

  if (debited > 0) {
    patient.wallet = balance - debited
    await patient.save()
    const wtxId = await nextId('wallet')
    await WalletTxModel.create({
      _id: wtxId, id: wtxId,
      patientId: patient.id, type: 'Debit', amount: debited,
      reason: `${inv.test} result (${inv.id})`, method: 'Wallet',
      staff: actor.name, at, balanceAfter: patient.wallet,
    })
  }

  const paid = shortfall <= 0.005
  const pay = new PaymentModel({
    _id: await nextId('payment'), id: '', ref: '',
    patientId: patient.id, patientName: `${patient.firstName} ${patient.surname}`,
    amount: price, method: 'Wallet',
    service: `${inv.test} (${inv.id})${paid ? '' : ' - balance outstanding'}`,
    staff: paid ? actor.name : 'System', at,
    status: paid ? 'Paid' : 'Pending',
  })
  pay.id = pay._id
  await pay.save()

  if (!paid) {
    await notify('Accountant', `Outstanding on ${inv.id} (${inv.test}): ₦${shortfall.toLocaleString()} for ${patient.firstName} ${patient.surname} (${patient.id}).`)
  }

  await ActivityModel.create({
    patientId: patient.id, time: at,
    what: `${inv.test} result submitted - ₦${price.toLocaleString()} charged${paid ? ' (wallet)' : ` (₦${shortfall.toLocaleString()} outstanding)`}`,
    meta: `${actor.role} - ${actor.name}`, dept: inv.dept === 'Radiology' ? 'Radiology' : 'Laboratory',
    green: true,
  })

  return { price, debitedFromWallet: debited, outstanding: shortfall, walletBalance: patient.wallet }
}

async function saveResult(id, file, { values }, actor) {
  const inv = await InvestigationModel.findById(id)
  if (!inv) {
    const err = new Error('Investigation not found'); err.status = 404; throw err
  }
  const text = String(values || '').trim()
  /* Either medium is enough: a photo/scan of the result sheet, or the values
     typed in. Previously a missing file blocked every text-only submission. */
  if (!file && !text) {
    const err = new Error('Attach a result image (photo/scan) or type the result values — either one is enough.')
    err.status = 400; throw err
  }
  const url = file ? await uploadResult(file, file.buffer) : ''
  const at = now()

  /* Bill once. A corrected re-upload must never charge the patient twice. */
  const alreadyBilled = inv.status === 'Completed'
  /* The admin may have re-priced this test since the request was raised — the
     price in force NOW is the one billed at upload (falls back to the stamped
     price when the catalogue knows nothing about the test). */
  inv.price = await resolvePrice(inv.test, inv.dept, { fallback: Number(inv.price) || 0 })
  const money = alreadyBilled
    ? { price: Number(inv.price) || 0, debitedFromWallet: 0, outstanding: 0, walletBalance: null }
    : await charge(inv.patientId, inv, actor, at)

  inv.status = 'Completed'
  inv.result = { image: url, values: text, at, by: actor.name }
  inv.chargedToWallet = money.debitedFromWallet > 0
  inv.paymentStatus = money.price === 0 ? 'Free' : (money.outstanding <= 0.005 ? 'Paid' : 'Pending')
  await inv.save()

  await broadcastActivity(
    { patientId: inv.patientId, time: at, what: `Investigation result uploaded: ${inv.test}`, meta: `${actor.role} - ${actor.name}`, dept: 'Nursing', green: true },
    undefined, actor.name,
  )
  /* Tell the requesting doctor (persisted bell + live toast + Web Push sound). */
  await notify('Doctor', `Result ready — ${inv.test} for ${inv.patientId} (${inv.visitId}) uploaded by ${actor.name}`)
  await audit(actor.name, 'Uploaded result', inv.patientId, inv.dept === 'Radiology' ? 'Radiology' : 'Laboratory',
    `${inv.id}${money.price ? ` - ₦${money.price.toLocaleString()}` : ''}`)

  /* Email the result notification to the patient when an address exists. */
  const patient = await PatientModel.findById(inv.patientId)
  if (patient?.email) {
    emailService.sendResultReady({ to: patient.email, patientName: `${patient.firstName} ${patient.surname}`, test: inv.test, values: inv.result.values })
  }
  return { ...clean(inv), ...money }
}

module.exports = { list, saveResult }
