/* Visit & consultation service — consultations create investigations and
 * prescriptions with live pharmacy prices. */
const { PatientModel, VisitModel, InvestigationModel, PrescriptionModel, DrugModel,
        AdmissionModel, PaymentModel, WalletTxModel, clean } = require('../models')
const { nextId, getSettings } = require('../config/db')
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

/* Accept both 'Admission' (what the Consultation screen sends) and the older
 * 'Admit', so the outcome is never silently ignored. */
const isAdmission = (v) => v === 'Admission' || v === 'Admit'

/**
 * Create the admission the doctor asked for, and bill the bed charge.
 * The doctor supplies the number of days and the cost per night; the total is
 * taken from the wallet when the balance covers it, otherwise a pending payment
 * is raised for the accountant.
 */
async function createAdmission(visit, body, actor) {
  const ad = body.admission || {}
  const days = Math.max(1, Number(body.days ?? ad.days) || 1)
  const costPerNight = Math.max(0, Number(body.costPerNight ?? ad.costPerNight ?? getSettings()?.defaultNightlyRate) || 0)
  const totalCost = days * costPerNight
  const at = now()
  const patient = await PatientModel.findById(visit.patientId)

  /* Take the bed charge from the wallet when it is affordable. */
  let chargedToWallet = false
  if (totalCost > 0 && patient) {
    const balance = Number(patient.wallet) || 0
    if (balance >= totalCost) {
      patient.wallet = balance - totalCost
      await patient.save()
      chargedToWallet = true
      const wtxId = await nextId('wallet')
      await WalletTxModel.create({
        _id: wtxId, id: wtxId,
        patientId: patient.id, type: 'Debit', amount: totalCost,
        reason: `Admission ${days} night(s) at ₦${costPerNight.toLocaleString()}/night`,
        method: 'Wallet', staff: actor.name, at, balanceAfter: patient.wallet,
      })
    }
  }

  const admission = new AdmissionModel({
    _id: await nextId('admission'), id: '',
    patientId: visit.patientId,
    patientName: patient ? `${patient.firstName} ${patient.surname}` : '',
    visitId: visit.id,
    ward: body.ward || ad.ward || 'Male Ward',
    bed: body.bed || ad.bed || '',
    doctor: actor.name, at,
    reason: ad.reason || visit.consultation?.diagnosis || body.diagnosis || 'Admitted after consultation',
    status: 'Admitted',
    days, costPerNight, totalCost, chargedToWallet,
  })
  admission.id = admission._id
  await admission.save()

  /* The bed charge always produces a revenue record: paid when it came off the
     wallet, pending when the accountant still has to collect it. */
  if (totalCost > 0) {
    const pay = new PaymentModel({
      _id: await nextId('payment'), id: '', ref: '',
      patientId: visit.patientId, patientName: admission.patientName,
      amount: totalCost, method: chargedToWallet ? 'Wallet' : 'Cash',
      service: `Admission ${days} night(s) — ${admission.ward} ${admission.bed}`.trim(),
      staff: actor.name, at, status: chargedToWallet ? 'Paid' : 'Pending',
    })
    pay.id = pay._id
    await pay.save()
    if (!chargedToWallet) {
      await notify('Accountant', `Bed charge pending: ₦${totalCost.toLocaleString()} for ${admission.patientName} (${admission.patientId}) — ${days} night(s) in ${admission.ward}.`)
    }
  }

  /* The visit is now an admission, and the ward/nursing team is told. */
  visit.type = 'Admission'
  visit.status = 'Admitted'
  await visit.save()
  await broadcastActivity(
    { patientId: visit.patientId, time: at, what: `Admitted to ${admission.ward} bed ${admission.bed} — ${days} night(s), ₦${totalCost.toLocaleString()}`, meta: `Doctor - ${actor.name}`, dept: 'Nursing', green: true },
    'Nurse', actor.name,
  )
  return clean(admission)
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
    const pricedItems = rxItems.filter((it) => it && it.drugId && Number(it.qty) > 0).map((it) => {
      const drug = drugs.find((d) => d.id === it.drugId)
      return {
        drugId: it.drugId, drug: drug?.name || it.drug || '',
        /* Route (IV/IM/Oral/Rectal), frequency (Daily/BD/TDS/…) and the course
           length in days come straight from the doctor's prescription form. */
        route: it.route || 'Oral',
        frequency: it.frequency || 'Daily',
        duration: Number(it.duration) || 1,
        qty: Number(it.qty) || 0,
        price: drug?.price || 0,
      }
    })
    if (pricedItems.length) {
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
  }

  /* Admit the patient when the doctor chose that outcome. Previously the
     outcome/ward/bed were accepted and then dropped on the floor, so no
     admission record was ever created. */
  let admission = null
  if (isAdmission(body.outcome)) admission = await createAdmission(visit, body, actor)

  await broadcastActivity(
    { patientId: visit.patientId, time: now(), what: `Consultation completed: ${body.diagnosis || 'See notes'}`, meta: `${actor.role} - ${actor.name}`, dept: 'Doctor', green: true },
    undefined, actor.name,
  )
  await audit(actor.name, 'Completed consultation', visit.patientId, 'Doctor')
  /* The admission (when the doctor admitted the patient) rides back with the
     visit so the UI can confirm the bed and the charge. */
  return { ...clean(visit), admission }
}

module.exports = { getVisit, completeConsultation }
