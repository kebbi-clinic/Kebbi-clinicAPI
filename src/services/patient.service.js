/* Patient service — registration, profiles, visits & the permanent patient ID rule:
 * one patient (KBC-XXXXXX) → many visits. Returning patients never get re-registered. */
const { PatientModel, VisitModel, VitalModel, InvestigationModel, PrescriptionModel,
        PaymentModel, AdmissionModel, WalletTxModel, ActivityModel, AuditModel, clean } = require('../models')
const { nextId, getSettings } = require('../config/db')
const { now } = require('../utils/datetime')
const { audit } = require('./audit.service')
const { notify } = require('./notification.service')
const { broadcastActivity } = require('../sockets/socket')
const emailService = require('./email.service')
const { INACTIVE_VIEW_ROLES, ACTIVATE_ROLES } = require('../constants')

const ADMIN_ROLES = ['Super Admin', 'Hospital Administrator']

/** May this role see patients who are currently Inactive? Only the accountant
 *  and the records officer do — clinical staff work from the active list. */
function canSeeInactive(role) {
  return ADMIN_ROLES.includes(role) || INACTIVE_VIEW_ROLES.includes(role)
}

/** May this role activate a patient? */
function canActivate(role) {
  return ADMIN_ROLES.includes(role) || ACTIVATE_ROLES.includes(role)
}

/** Patient list scoped to the caller's role. `?status=` forces a specific
 *  status (admins may pass status=Inactive; clinical roles are refused it).
 *  `?q=` searches server-side by id / name / phone, page by page — the
 *  hospital app never has to download 30,000 records to pick one. */
async function list(role, { status, q, page, limit } = {}) {
  const query = {}
  if (status === 'Active' || status === 'Inactive') {
    if (status === 'Inactive' && !canSeeInactive(role)) {
      const err = new Error('Your role may only view active patients. Inactive patients are visible to the Records Officer and the Accountant.')
      err.status = 403; throw err
    }
    query.status = status
  } else if (!canSeeInactive(role)) {
    query.status = { $ne: 'Inactive' }
  }
  /* Server-side patient search: every whitespace-separated term must match
     id / firstName / otherName / surname / phone (same rule as the app's
     search boxes, enforced in Mongo so 30k patients never cross the wire).
     `page`/`limit` bound the payload; `total` tells the UI there is more. */
  const terms = String(q || '').trim().split(/\s+/).filter(Boolean).slice(0, 8)
  if (terms.length) {
    query.$and = terms.map((t) => {
      const rx = new RegExp(escapeRegex(t), 'i')
      return { $or: [{ id: rx }, { firstName: rx }, { otherName: rx }, { surname: rx }, { phone: rx }] }
    })
  }
  const perPage = Math.min(Math.max(Number(limit) || PATIENT_PAGE, 1), 100)
  const pageNum = Math.max(Number(page) || 1, 1)
  const [total, rows] = await Promise.all([
    PatientModel.countDocuments(query),
    PatientModel.find(query).sort('-registeredAt').skip((pageNum - 1) * perPage).limit(perPage),
  ])
  return { items: rows.map(clean), total, page: pageNum, limit: perPage }
}

async function register(body, actor) {
  const id = await nextId('patient')
  const patient = new PatientModel({
    _id: id, id, ...body, status: 'Inactive', wallet: 0,
    registered: now(), registeredAt: now(),
    nextOfKin: body.nextOfKin || { name: '', relationship: '', phone: '', address: '' },
  })
  await patient.save()
  await audit(actor.name, 'Registered patient', id, 'Records')
  await notify('Super Admin', `${actor.name} registered patient ${id}`)

  /* Email the registration confirmation when the patient provided an address. */
  if (patient.email) {
    emailService.sendEmail({
      to: patient.email,
      subject: 'Welcome to Kebbi Clinic — registration confirmed',
      title: 'Registration confirmed',
      bodyHtml: `<p>Dear ${patient.firstName},</p><p>You have been registered at Kebbi Clinic.</p>
        <p><b>Patient ID:</b> ${id}<br/><b>Date:</b> ${patient.registeredAt}</p>
        <p>Please quote your Patient ID at every visit.</p>`,
    })
  }
  return clean(patient)
}

/** Escape user text before it goes inside a RegExp. */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Default page size for the patient list/search. */
const PATIENT_PAGE = 50

function notFound(msg) {
  const err = new Error(msg); err.status = 404
  return err
}

/* 360° record (admin app) — everything about one patient, including "who attended to them". */
async function get360(id) {
  const patient = await PatientModel.findById(id)
  if (!patient) throw notFound('Patient not found')
  const [visits, vitals, investigations, prescriptions, payments, admissions, walletTxs, activity, auditRows] = await Promise.all([
    VisitModel.find({ patientId: id }).sort('-createdAt').lean(),
    VitalModel.find({ patientId: id }).sort('-at').lean(),
    InvestigationModel.find({ patientId: id }).sort('-createdAt').lean(),
    PrescriptionModel.find({ patientId: id }).sort('-createdAt').lean(),
    PaymentModel.find({ patientId: id }).sort('-at').lean(),
    AdmissionModel.find({ patientId: id }).sort('-at').lean(),
    WalletTxModel.find({ patientId: id }).sort('-at').lean(),
    ActivityModel.find({ patientId: id }).sort('time').lean(),
    AuditModel.find({ target: id }).sort('-when').lean(),
  ])

  const careTeam = []
  const push = (role, name, action, at) => { if (name) careTeam.push({ role, name, action, at }) }
  visits.forEach((v) => v.consultation && push('Doctor', v.consultation.doctor, `Consultation — ${v.consultation.diagnosis || 'no diagnosis'}`, v.consultation.at))
  vitals.forEach((v) => push('Nurse', v.staff, `Vitals — T ${v.temp}, BP ${v.bp}`, v.at))
  investigations.forEach((i) => {
    push('Doctor', i.doctor, `Requested ${i.dept} test — ${i.test}`, i.createdAt)
    if (i.result && i.result.by) push(i.dept === 'Lab' ? 'Laboratory Scientist' : 'Radiologist', i.result.by, `Uploaded ${i.test} result`, i.result.at)
  })
  prescriptions.forEach((r) => {
    push('Doctor', r.doctor, `Prescribed ${r.items.length} drug(s)`, r.createdAt)
    if (r.status === 'Dispensed') push('Pharmacist', r.dispensedBy || 'Pharmacy', `Dispensed ${r.id}`, r.dispensedAt || r.createdAt)
  })
  payments.forEach((y) => push('Accountant', y.staff, `${y.service} — N${Number(y.amount).toLocaleString()} (${y.method})`, y.at))
  admissions.forEach((a) => {
    push('Doctor', a.doctor, `Admitted to ${a.ward} / ${a.bed} — ${a.reason}`, a.at)
    if (a.discharge && a.discharge.staff) push('Doctor', a.discharge.staff, `Discharged — ${a.discharge.diagnosis}`, a.discharge.date)
  })

  return {
    patient: clean(patient),
    visits: visits.map(clean), vitals: vitals.map(clean),
    investigations: investigations.map(clean), prescriptions: prescriptions.map(clean),
    payments: payments.map(clean), admissions: admissions.map(clean),
    walletTxs: walletTxs.map(clean), activity: activity.map(clean),
    audit: auditRows.map(clean), careTeam,
    summary: {
      visits: visits.length, vitals: vitals.length, investigations: investigations.length,
      prescriptions: prescriptions.length, payments: payments.length, admissions: admissions.length,
      totalPaid: payments.reduce((t, y) => t + (Number(y.amount) || 0), 0), wallet: patient.wallet,
    },
  }
}

/* Lightweight profile for the hospital-app patient page. */
async function getBasic(id) {
  const patient = await PatientModel.findById(id)
  if (!patient) throw notFound('Patient not found')
  const [visits, vitals, investigations, prescriptions, payments, admissions, walletTxs, activity] = await Promise.all([
    VisitModel.find({ patientId: id }).sort('-createdAt').lean(),
    VitalModel.find({ patientId: id }).sort('-at').lean(),
    InvestigationModel.find({ patientId: id }).sort('-createdAt').lean(),
    PrescriptionModel.find({ patientId: id }).sort('-createdAt').lean(),
    PaymentModel.find({ patientId: id }).sort('-at').lean(),
    AdmissionModel.find({ patientId: id }).sort('-at').lean(),
    WalletTxModel.find({ patientId: id }).sort('-at').lean(),
    ActivityModel.find({ patientId: id }).sort('time').lean(),
  ])
  return {
    ...clean(patient),
    visits: visits.map(clean), vitals: vitals.map(clean),
    investigations: investigations.map(clean), prescriptions: prescriptions.map(clean),
    payments: payments.map(clean), admissions: admissions.map(clean),
    walletTxs: walletTxs.map(clean), activity: activity.map(clean),
  }
}

async function startVisit(id, actor) {
  const patient = await PatientModel.findById(id)
  if (!patient) throw notFound('Patient not found')
  patient.status = 'Active'
  await patient.save()
  const visit = new VisitModel({ _id: await nextId('visit'), id: '', patientId: patient.id, date: now(), createdAt: now(), type: 'Outpatient', status: 'Open' })
  visit.id = visit._id
  await visit.save()
  await ActivityModel.create({ patientId: patient.id, time: now(), what: 'New visit started', meta: `${actor.role} - ${actor.name}`, dept: actor.role, green: true })
  broadcastActivity({ patientId: patient.id, time: now(), what: 'New visit started', meta: `${actor.role} - ${actor.name}`, dept: actor.role, green: true }, undefined, actor.name)
  await audit(actor.name, 'Started visit', patient.id, 'Records')
  return clean(visit)
}

async function setStatus(id, status, actor) {
  const patient = await PatientModel.findById(id)
  if (!patient) throw notFound('Patient not found')

  /* Activating is a records action and is charged to the patient's wallet. */
  if (status === 'Active') return activate(patient, actor)

  if (patient.status === status) return clean(patient)
  patient.status = status
  await patient.save()
  await audit(actor.name, `Patient ${patient.status}`, patient.id, 'Records')
  return clean(patient)
}

/**
 * Activate a patient — Records Officer only (the route enforces the
 * `patients.activate` capability). The configured activation fee is deducted
 * from the patient's wallet, with a matching wallet-ledger row and a paid
 * payment record, so the money is always accounted for. The patient is then
 * pushed onto the nurses' "new patients" queue.
 */
async function activate(patientOrId, actor) {
  const patient = typeof patientOrId === 'string'
    ? await PatientModel.findById(patientOrId)
    : patientOrId
  if (!patient) throw notFound('Patient not found')

  if (patient.status === 'Active') {
    return { ...clean(patient), activationFee: 0, alreadyActive: true }
  }

  const fee = Number(getSettings()?.activationFee) || 0
  const balance = Number(patient.wallet) || 0
  if (fee > 0 && balance < fee) {
    const err = new Error(
      `Cannot activate ${patient.id}: the activation fee is ₦${fee.toLocaleString()} but the wallet holds only ₦${balance.toLocaleString()}. Fund the wallet first.`,
    )
    err.status = 400
    throw err
  }

  const at = now()
  patient.status = 'Active'
  patient.activatedAt = at
  patient.activatedBy = actor.name
  if (fee > 0) patient.wallet = balance - fee
  await patient.save()

  /* The wallet ledger and the revenue record for the activation charge. */
  if (fee > 0) {
    const wtxId = await nextId('wallet')
    await WalletTxModel.create({
      _id: wtxId, id: wtxId,
      patientId: patient.id, type: 'Debit', amount: fee,
      reason: 'Patient activation', method: 'Wallet',
      staff: actor.name, at, balanceAfter: patient.wallet,
    })
    const pay = new PaymentModel({
      _id: await nextId('payment'), id: '', ref: '',
      patientId: patient.id, patientName: `${patient.firstName} ${patient.surname}`,
      amount: fee, method: 'Wallet', service: 'Patient activation',
      staff: actor.name, at, status: 'Paid',
    })
    pay.id = pay._id
    await pay.save()
  }

  const text = fee > 0
    ? `Patient activated - activation fee ₦${fee.toLocaleString()} taken from wallet`
    : 'Patient activated'
  await ActivityModel.create({
    patientId: patient.id, time: at, what: text,
    meta: `Records - ${actor.name}`, dept: 'Records', green: true,
  })
  broadcastActivity(
    { patientId: patient.id, time: at, what: text, meta: `Records - ${actor.name}`, dept: 'Records', green: true },
    'Nurse', actor.name,
  )
  /* Nurses pick the patient up from their dashboard "new patients" queue. */
  await notify('Nurse', `New patient activated: ${patient.firstName} ${patient.surname} (${patient.id}) — ready for vitals.`)
  await audit(actor.name, 'Activated patient', patient.id, 'Records',
    fee > 0 ? `Activation fee ₦${fee.toLocaleString()} charged to wallet` : undefined)

  return { ...clean(patient), activationFee: fee, alreadyActive: false }
}

module.exports = {
  list, register, get360, getBasic, startVisit, setStatus, activate,
  canSeeInactive, canActivate,
}
