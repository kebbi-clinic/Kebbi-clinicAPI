/* Patient service — registration, profiles, visits & the permanent patient ID rule:
 * one patient (KBC-XXXXXX) → many visits. Returning patients never get re-registered. */
const { PatientModel, VisitModel, VitalModel, InvestigationModel, PrescriptionModel,
        PaymentModel, AdmissionModel, WalletTxModel, ActivityModel, AuditModel, clean } = require('../models')
const { nextId } = require('../config/db')
const { now } = require('../utils/datetime')
const { audit } = require('./audit.service')
const { notify } = require('./notification.service')
const { broadcastActivity } = require('../sockets/socket')
const emailService = require('./email.service')

async function list() {
  const rows = await PatientModel.find().sort('-registeredAt')
  return rows.map(clean)
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
  patient.status = status
  await patient.save()
  await audit(actor.name, `Patient ${patient.status}`, patient.id, 'Records')
  return clean(patient)
}

module.exports = { list, register, get360, getBasic, startVisit, setStatus }
