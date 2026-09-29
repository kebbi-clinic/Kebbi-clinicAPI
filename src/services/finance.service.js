/* Finance service — wallet funding, payment & wallet ledgers, revenue stats. */
const { PatientModel, PaymentModel, WalletTxModel, ActivityModel, clean } = require('../models')
const { nextId } = require('../config/db')
const { now } = require('../utils/datetime')
const { audit } = require('./audit.service')
const { broadcastActivity } = require('../sockets/socket')
const emailService = require('./email.service')

async function listPayments() {
  const rows = await PaymentModel.find().sort('-at')
  return rows.map(clean)
}

async function listWalletTxs() {
  const rows = await WalletTxModel.find().sort('-at')
  return rows.map(clean)
}

async function fundWallet(body, actor) {
  const patient = await PatientModel.findById(body.patientId)
  if (!patient) {
    const err = new Error('Patient not found'); err.status = 404; throw err
  }
  const amount = Number(body.amount)
  patient.wallet += amount
  await patient.save()

  const tx = new WalletTxModel()
  tx._id = await nextId('wallet'); tx.id = tx._id
  tx.patientId = patient.id; tx.type = 'Credit'; tx.amount = amount
  tx.reason = `Wallet funding (${body.reference || 'no reference'})`; tx.method = body.method || 'Cash'
  tx.staff = `${actor.role} ${actor.name}`; tx.at = now(); tx.balanceAfter = patient.wallet
  await tx.save()

  const pay = new PaymentModel()
  pay._id = await nextId('payment'); pay.id = pay._id
  pay.ref = ''; pay.patientId = patient.id; pay.patientName = `${patient.firstName} ${patient.surname}`
  pay.amount = amount; pay.method = body.method || 'Cash'; pay.service = 'Wallet funding'
  pay.staff = actor.name; pay.at = now(); pay.status = 'Paid'
  await pay.save()

  const text = `Wallet credited ₦${amount.toLocaleString()}`
  await ActivityModel.create({ patientId: patient.id, time: now(), what: text, meta: `Accounting - ${actor.name}`, dept: 'Accounting', green: true })
  broadcastActivity({ patientId: patient.id, time: now(), what: text, meta: `Accounting - ${actor.name}`, dept: 'Accounting', green: true }, undefined, actor.name)
  await audit(actor.name, 'Credited wallet', patient.id, 'Accounting', `₦${amount.toLocaleString()} (${body.method || 'Cash'})`)

  /* Email the wallet receipt when the patient provided an address. */
  if (patient.email) {
    emailService.sendEmail({
      to: patient.email,
      subject: 'Kebbi Clinic — wallet credited',
      title: 'Wallet credited',
      bodyHtml: `<p>Dear ${patient.firstName},</p><p>Your wallet has been credited.</p>
        <p><b>Amount:</b> ₦${amount.toLocaleString()}<br/><b>Method:</b> ${pay.method}<br/><b>New balance:</b> ₦${patient.wallet.toLocaleString()}</p>`,
    })
  }
  return { tx: clean(tx), payment: clean(pay), balance: patient.wallet }
}

module.exports = { listPayments, listWalletTxs, fundWallet }
