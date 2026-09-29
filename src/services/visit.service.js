/* Visit & consultation service — consultations create investigations and
 * prescriptions with live pharmacy prices. */
const { PatientModel, VisitModel, InvestigationModel, PrescriptionModel, DrugModel, clean } = require('../models')
const { nextId } = require('../config/db')
const { now } = require('../utils/datetime')
const { audit } = require('./audit.service')
const { broadcastActivity } = require('../sockets/socket')
const { notify } = require('./notification.service')

/* Investigations may arrive as strings ("FBC") or objects ({ test, dept, price }),
 * with an optional invDept map — accept all three for frontend compatibility. */
function normaliseInvestigations(raw, invDept) {
  if (!Array.isArray(raw)) return []
  return raw.map((t) => {
    if (typeof t === 'string') {
      return { test: t, dept: invDept?.[t] || 'Lab', price: 0 }
    }
    return {
      test: t.test, dept: t.dept || invDept?.[t.test] || 'Lab', price: t.price || 0,
    }
  }).filter((t) => t.test)
}

async function getVisit(id) {
  const visit = await VisitModel.findById(id)
  if (!visit) {
    const err = new Error('Visit not found'); err.status = 404; throw err
  }
  const patient = await PatientModel.findById(visit.patientId)
  const drugs = await DrugModel.find()
  const items = (visit.consultation?.prescriptionItems || []).map((it) => ({
    drugId: it.drugId, drug: it.drug, qty: it.qty,
    price: drugs.find((d) => d.id === it.drugId)?.price || it.price,
  }))
  return { ...clean(visit), patient: patient ? clean(patient) : null, pricedItems: items }
}

async function completeConsultation(visitId, body, actor) {
  const visit = await VisitModel.findById(visitId)
  if (!visit) {
    const err = new Error('Visit not found'); err.status = 404; throw err
  }
  visit.consultation = {
    complaint: body.complaint || '', history: body.history || '', exam: body.exam || '',
    diagnosis: body.diagnosis || '', doctor: actor.name, at: now(),
  }
  visit.consultationItems = body.items || body.rx || []
  visit.diagnosis = body.diagnosis || ''
  await visit.save()

  /* Create investigations */
  const invs = normaliseInvestigations(body.investigations, body.invDept)
  if (invs.length) {
    const created = []
    for (const t of invs) {
      const inv = new InvestigationModel({
        _id: await nextId('investigation'), id: '',
        patientId: visit.patientId, visitId: visit.id, dept: t.dept, test: t.test,
        doctor: actor.name, createdAt: now(), status: 'Pending', price: t.price,
      })
      inv.id = inv._id
      await inv.save()
      created.push(clean(inv))
    }
    /* Route each request to the RIGHT queue: radiology tests wake the Radiologist,
     * lab tests the Laboratory Scientist. notify() persists the alert (visible in
     * the bell even if they were offline), pushes it live AND sends a Web Push. */
    const byDept = { Lab: [], Radiology: [] }
    created.forEach((i) => (byDept[i.dept === 'Radiology' ? 'Radiology' : 'Lab'].push(i.test)))
    for (const [dept, tests] of Object.entries(byDept)) {
      if (!tests.length) continue
      const role = dept === 'Radiology' ? 'Radiologist' : 'Laboratory Scientist'
      await broadcastActivity(
        { patientId: visit.patientId, time: now(), what: `${dept} investigation${tests.length > 1 ? 's' : ''} requested: ${tests.join(', ')}`, meta: `${actor.role} - ${actor.name}`, dept, green: true },
        undefined, actor.name,
      )
      await notify(role, `New ${dept} request from ${actor.role} ${actor.name} (${visit.patientId}): ${tests.join(', ')}`)
    }
  }

  /* Create prescription (accepts `items` or legacy `rx`; uses live pharmacy prices) */
  const rxItems = Array.isArray(body.items) && body.items.length ? body.items : (body.rx || [])
  if (Array.isArray(rxItems) && rxItems.length) {
    const drugs = await DrugModel.find()
    const pricedItems = rxItems.map((it) => ({
      drugId: it.drugId, drug: it.drug, qty: it.qty,
      price: drugs.find((d) => d.id === it.drugId)?.price || 0,
    }))
    const total = pricedItems.reduce((s, x) => s + x.price * x.qty, 0)
    const rx = new PrescriptionModel({
      _id: await nextId('prescription'), id: '',
      patientId: visit.patientId, patientName: '', doctor: actor.name,
      visitId: visit.id, createdAt: now(), items: pricedItems, status: 'Pending',
    })
    rx.id = rx._id
    const patient = await PatientModel.findById(visit.patientId)
    if (patient) rx.patientName = `${patient.firstName} ${patient.surname}`
    await rx.save()
    await broadcastActivity(
      { patientId: visit.patientId, time: now(), what: `Prescription created (₦${total.toLocaleString()})`, meta: `Pharmacy - ${actor.name}`, dept: 'Pharmacy', green: true },
      'Pharmacist', actor.name,
    )
  }

  await broadcastActivity(
    { patientId: visit.patientId, time: now(), what: `Consultation completed: ${body.diagnosis || 'See notes'}`, meta: `${actor.role} - ${actor.name}`, dept: 'Doctor', green: true },
    undefined, actor.name,
  )
  await audit(actor.name, 'Completed consultation', visit.patientId, 'Doctor')
  return clean(visit)
}

module.exports = { getVisit, completeConsultation }
