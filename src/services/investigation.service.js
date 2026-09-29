/* Laboratory & Radiology service — request queue and result upload. */
const { InvestigationModel, clean } = require('../models')
const { now } = require('../utils/datetime')
const { audit } = require('./audit.service')
const { broadcastActivity } = require('../sockets/socket')
const { notify } = require('./notification.service')
const { uploadResult } = require('../services/storage.service')
const emailService = require('./email.service')
const { PatientModel } = require('../models')

async function list(dept) {
  const filter = dept ? { dept: dept === 'Radiology' ? 'Radiology' : 'Lab' } : {}
  const list = await InvestigationModel.find(filter).sort('-createdAt')
  return list.map(clean)
}

async function saveResult(id, file, { values }, actor) {
  const inv = await InvestigationModel.findById(id)
  if (!inv) {
    const err = new Error('Investigation not found'); err.status = 404; throw err
  }
  if (!file) {
    const err = new Error('Result image is required'); err.status = 400; throw err
  }
  const url = await uploadResult(file, file.buffer)
  inv.status = 'Completed'
  inv.result = { image: url, values: values || '', at: now(), by: actor.name }
  await inv.save()

  await broadcastActivity(
    { patientId: inv.patientId, time: now(), what: `Investigation result uploaded: ${inv.test}`, meta: `${actor.role} - ${actor.name}`, dept: 'Nursing', green: true },
    undefined, actor.name,
  )
  /* Tell the requesting doctor (persisted bell + live toast + Web Push sound). */
  await notify('Doctor', `Result ready — ${inv.test} for ${inv.patientId} (${inv.visitId}) uploaded by ${actor.name}`)
  await audit(actor.name, 'Uploaded result', inv.patientId, inv.dept === 'Radiology' ? 'Radiology' : 'Laboratory', inv.id)

  /* Email the result notification to the patient when an address exists. */
  const patient = await PatientModel.findById(inv.patientId)
  if (patient?.email) {
    emailService.sendResultReady({ to: patient.email, patientName: `${patient.firstName} ${patient.surname}`, test: inv.test, values: inv.result.values })
  }
  return clean(inv)
}

module.exports = { list, saveResult }
