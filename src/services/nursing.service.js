/* Nursing service — vitals & admissions/discharge. */
const { VitalModel, ActivityModel, AdmissionModel, VisitModel, PatientModel, clean } = require('../models')
const { nextId } = require('../config/db')
const { now } = require('../utils/datetime')
const { audit } = require('./audit.service')
const { notify } = require('./notification.service')
const { broadcastActivity } = require('../sockets/socket')

async function listVitals(patientId) {
  const filter = patientId ? { patientId } : {}
  const list = await VitalModel.find(filter).sort('-at')
  return list.map(clean)
}

async function createVitals(body, actor) {
  const vital = new VitalModel({
    _id: await nextId('vital'), id: '',
    patientId: body.patientId, visitId: body.visitId, staff: actor.name,
    temp: body.temp || '—', bp: body.bp || '—', pulse: body.pulse || '—', resp: body.resp || '—',
    spo2: body.spo2 || '—', weight: body.weight || '—', at: now(),
  })
  vital.id = vital._id
  await vital.save()

  const text = `Vitals recorded - T ${body.temp} - BP ${body.bp}`
  await ActivityModel.create({ patientId: body.patientId, time: now(), what: text, meta: `${actor.role} - ${actor.name}`, dept: 'Nursing', green: true })
  broadcastActivity({ patientId: body.patientId, time: now(), what: text, meta: `${actor.role} - ${actor.name}`, dept: 'Nursing', green: true }, undefined, actor.name)
  await audit(actor.name, 'Recorded vitals', body.patientId, 'Nursing')

  /* Once vitals are in, the patient belongs on the doctor's desk. Mark the
     visit as waiting for consultation (only if it has not been seen yet) and
     push the patient onto the doctors' pending-consultation queue. */
  const visit = await VisitModel.findOne({ id: body.visitId })
  const firstVitals = visit ? !(await VitalModel.countDocuments({ visitId: body.visitId, _id: { $ne: vital._id } })) : false
  if (visit && !visit.consultation && visit.status !== 'Completed' && firstVitals) {
    visit.status = 'Waiting'
    await visit.save()
  }
  if (firstVitals) {
    const patient = await PatientModel.findById(body.patientId)
    const who = patient ? `${patient.firstName} ${patient.surname}` : body.patientId
    await notify('Doctor', `Pending consultation: ${who} (${body.patientId}) — vitals recorded by ${actor.name}.`)
    broadcastActivity(
      { patientId: body.patientId, time: now(), what: `Awaiting consultation — vitals recorded (T ${body.temp}, BP ${body.bp})`, meta: `Nursing - ${actor.name}`, dept: 'Doctor', green: true },
      'Doctor', actor.name,
    )
  }
  return clean(vital)
}

async function listAdmissions() {
  const list = await AdmissionModel.find().sort('-at')
  return list.map(clean)
}

async function discharge(id, body, actor) {
  const admission = await AdmissionModel.findById(id)
  if (!admission) {
    const err = new Error('Admission not found'); err.status = 404; throw err
  }
  admission.status = 'Discharged'
  admission.discharge = {
    date: now(), diagnosis: body.diagnosis || admission.reason,
    summary: body.summary || '', notes: body.notes || '', staff: actor.name,
  }
  await admission.save()
  const visit = await VisitModel.findOne({ id: admission.visitId })
  if (visit) { visit.status = 'Completed'; await visit.save() }

  /* Discharge closes the patient's episode: they are automatically deactivated
     (Active → Inactive). History is fully preserved and the Records Officer can
     re-activate them (which charges the activation fee) on their next visit. */
  let deactivated = false
  const patient = await PatientModel.findById(admission.patientId)
  if (patient && patient.status === 'Active') {
    patient.status = 'Inactive'
    patient.deactivatedAt = now()
    patient.deactivatedBy = actor.name
    patient.deactivatedReason = 'Discharged'
    await patient.save()
    deactivated = true
  }

  const text = deactivated
    ? `Patient discharged from ${admission.ward} — patient marked INACTIVE automatically`
    : `Patient discharged from ${admission.ward}`
  await ActivityModel.create({ patientId: admission.patientId, time: now(), what: text, meta: `${actor.role} - ${actor.name}`, dept: 'Nursing', green: true })
  broadcastActivity(
    { patientId: admission.patientId, time: now(), what: text, meta: `${actor.role} - ${actor.name}`, dept: 'Nursing', green: true },
    'Records Officer', actor.name,
  )
  if (deactivated) {
    await notify('Records Officer', `${patient.firstName} ${patient.surname} (${patient.id}) was discharged and is now INACTIVE — re-activate when they return.`)
  }
  await audit(actor.name, 'Discharged patient', admission.patientId, 'Nursing',
    `${admission.id}${deactivated ? ' — deactivated' : ''}`)
  return { ...clean(admission), patientDeactivated: deactivated }
}

module.exports = { listVitals, createVitals, listAdmissions, discharge }
