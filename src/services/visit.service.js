/* Visit & consultation service — consultations create investigations and
 * prescriptions with live pharmacy prices. */
const { PatientModel, VisitModel, InvestigationModel, PrescriptionModel, DrugModel,
        AdmissionModel, PaymentModel, WalletTxModel, clean } = require('../models')
const { nextId, getSettings } = require('../config/db')
const { now } = require('../utils/datetime')
const { assertWalletCovers } = require('../utils/wallet')
const { audit } = require('./audit.service')
const { broadcastActivity } = require('../sockets/socket')
const { notify } = require('./notification.service')
const { resolvePrice } = require('./test.service')

/* Investigations arrive from the Consultation screen as plain test names
 * ("FBC") or as objects ({ test, dept, price }), with an optional invDept map —
 * accept all three for frontend compatibility.
 *
 * The price is resolved here, once, at request time from the lab/radiology
 * test catalogue (the admin's editable price list) and stamped onto the
 * investigation. It is re-read again at result upload — the billable moment —
 * so an admin price edit always wins until the patient is actually billed. */
async function normaliseInvestigations(raw, invDept) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const t of raw) {
    if (typeof t === 'string') {
      const dept = invDept?.[t] || 'Lab'
      out.push({ test: t, dept, price: await resolvePrice(t, dept) })
    } else if (t && t.test) {
      const dept = t.dept || invDept?.[t.test] || 'Lab'
      /* The catalogue/settings price wins over anything the client sent; the
         client price is only a last-resort fallback for unknown tests. */
      out.push({ test: t.test, dept, price: await resolvePrice(t.test, dept, { fallback: Number(t.price) || 0 }) })
    }
  }
  return out.filter((t) => t.test)
}

/* Accept both 'Admission' (what the Consultation screen sends) and the older
 * 'Admit', so the outcome is never silently ignored. */
const isAdmission = (v) => v === 'Admission' || v === 'Admit'

/**
 * Create the admission the doctor asked for, and bill the bed charge.
 * The doctor supplies the number of days and the cost per night; the total is
 * taken from the patient's wallet. completeConsultation checked affordability
 * BEFORE anything was written, so a short wallet never reaches this point — the
 * consultation is refused outright with a "top up the patient's wallet" error
 * instead of being admitted with the charge left pending.
 */
async function createAdmission(visit, body, actor) {
  const ad = body.admission || {}
  const days = Math.max(1, Number(body.days ?? ad.days) || 1)
  const costPerNight = Math.max(0, Number(body.costPerNight ?? ad.costPerNight ?? getSettings()?.defaultNightlyRate) || 0)
  const totalCost = days * costPerNight
  const at = now()
  const patient = await PatientModel.findById(visit.patientId)

  /* Take the bed charge from the wallet. The affordability guard at the top of
     completeConsultation already refused any short wallet, so this debit is
     always in full — and the wallet ledger row doubles as the receipt. */
  let chargedToWallet = false
  let wtx = null
  if (totalCost > 0 && patient) {
    const balance = Number(patient.wallet) || 0
    patient.wallet = balance - totalCost
    await patient.save()
    chargedToWallet = true
    const wtxId = await nextId('wallet')
    wtx = await WalletTxModel.create({
      _id: wtxId, id: wtxId,
      patientId: patient.id,
      patientName: `${patient.firstName} ${patient.surname}`,
      patientSex: patient.gender || '',
      type: 'Debit', amount: totalCost,
      reason: `Admission ${days} night(s) at ₦${costPerNight.toLocaleString()}/night`,
      method: 'Wallet', staff: actor.name, staffRole: actor.role || '',
      at, balanceAfter: patient.wallet,
    })
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

  /* The bed charge always produces a revenue record — paid in full, because a
     short wallet was refused before the admission was ever created. The wallet
     ledger row (when there is one) is the receipt for this payment. */
  let pay = null
  if (totalCost > 0) {
    pay = new PaymentModel({
      _id: await nextId('payment'), id: '', ref: '',
      patientId: visit.patientId, patientName: admission.patientName,
      patientSex: patient ? patient.gender || '' : '',
      amount: totalCost, method: chargedToWallet ? 'Wallet' : 'Cash',
      service: `Admission ${days} night(s) — ${admission.ward} ${admission.bed}`.trim(),
      staff: actor.name, staffRole: actor.role || '',
      txId: wtx ? wtx.id : '',
      at, status: 'Paid',
    })
    pay.id = pay._id
    await pay.save()
  }

  /* The visit is now an admission, and the ward/nursing team is told. */
  visit.type = 'Admission'
  visit.status = 'Admitted'
  await visit.save()
  await broadcastActivity(
    { patientId: visit.patientId, time: at, what: `Admitted to ${admission.ward} bed ${admission.bed} — ${days} night(s), ₦${totalCost.toLocaleString()}`, meta: `Doctor - ${actor.name}`, dept: 'Nursing', green: true },
    'Nurse', actor.name,
  )
  /* The wallet ledger row rides along so the doctor can open the receipt for the
     bed charge straight away. */
  return { ...clean(admission), walletTx: wtx ? clean(wtx) : null, payment: pay ? clean(pay) : null }
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

  /* AFFORDABILITY FIRST: admitting the patient bills the bed charge (nights ×
     rate) to the wallet straight away. Check it BEFORE anything is written — a
     short wallet must refuse the whole consultation with a "top up the patient's
     wallet" error rather than admit the patient and leave the charge pending.
     The arithmetic mirrors createAdmission exactly. */
  if (isAdmission(body.outcome)) {
    const ad = body.admission || {}
    const days = Math.max(1, Number(body.days ?? ad.days) || 1)
    const rate = Math.max(0, Number(body.costPerNight ?? ad.costPerNight ?? getSettings()?.defaultNightlyRate) || 0)
    const bedTotal = days * rate
    if (bedTotal > 0) {
      const p = await PatientModel.findById(visit.patientId)
      if (p) assertWalletCovers(p, bedTotal, `the bed charge (${days} night${days > 1 ? 's' : ''})`)
    }
  }

  const isRevisit = !!visit.consultation
  visit.consultation = {
    complaint: body.complaint || '', history: body.history || '', exam: body.exam || '',
    diagnosis: body.diagnosis || '', doctor: actor.name, at: now(),
  }
  visit.consultationItems = body.items || body.rx || []
  visit.diagnosis = body.diagnosis || ''
  /* Close the visit once it has been seen. Before this the visit stayed
     "Open"/"Waiting" forever, so it kept showing up as a pending consultation
     and the patient could be billed again on every re-save. An admission
     overwrites this with "Admitted" further down. */
  visit.status = 'Completed'
  await visit.save()

  /* Create investigations — but only the first time round. Re-opening a saved
     consultation must not queue the same tests twice (which would charge the
     patient twice), so anything already raised for this visit is left alone. */
  const invs = await normaliseInvestigations(body.investigations, body.invDept)
  const alreadyRequested = isRevisit
    ? await InvestigationModel.countDocuments({ visitId: visit.id })
    : 0
  if (invs.length && !alreadyRequested) {
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

  /* Create prescription (accepts `items` or legacy `rx`; uses live pharmacy prices).
     Guarded like the investigations above: re-saving a consultation must not put
     the same drugs on the pharmacy queue a second time. */
  const rxItems = Array.isArray(body.items) && body.items.length ? body.items : (body.rx || [])
  const alreadyPrescribed = isRevisit
    ? await PrescriptionModel.countDocuments({ visitId: visit.id })
    : 0
  if (Array.isArray(rxItems) && rxItems.length && !alreadyPrescribed) {
    const drugs = await DrugModel.find()
    const pricedItems = rxItems.filter((it) => it && it.drugId && Number(it.qty) > 0).map((it) => {
      const drug = drugs.find((d) => d.id === it.drugId)
      return {
        drugId: it.drugId, drug: drug?.name || it.drug || '',
        /* Route (IV/IM/Oral/Rectal), frequency (Daily/BD/TDS/…), dosage
           strength (80mg/500mg/…) and the course length in days come straight
           from the doctor's prescription form. */
        route: it.route || 'Oral',
        frequency: it.frequency || 'Daily',
        dose: String(it.dose || '').trim().slice(0, 40),
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
      /* Persisted notification as well as the live fan-out — otherwise a
         pharmacist who is offline when the doctor prescribes never learns the
         prescription exists and it sits unactioned on their queue. */
      await notify('Pharmacist', `New prescription ${rx.id} for ${rx.patientName || visit.patientId} (${visit.id}) — ₦${total.toLocaleString()}`)
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
