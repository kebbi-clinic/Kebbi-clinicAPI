/* Dashboard service — role-specific counters computed live from the database,
 * plus hospital-wide stats for the Admin app. */
const { PatientModel, StaffModel, VisitModel, PaymentModel, PrescriptionModel,
        InvestigationModel, AdmissionModel, DrugModel, WalletTxModel, AuditModel,
        VitalModel, clean } = require('../models')
const { getSettings } = require('../config/db')
const { now, parseWhen, dayPrefix } = require('../utils/datetime')

const sum = (rows) => rows.reduce((t, r) => t + (Number(r.amount) || 0), 0)
const nameOf = (p) => (p ? `${p.firstName || ''} ${p.surname || ''}`.trim() : '')
const byTimeDesc = (field) => (a, b) => String(b[field] || '').localeCompare(String(a[field] || ''))

/**
 * Role dashboard.
 *
 * Returns `{ role, caps, stats, ...lists }` — the shape the hospital app's
 * Dashboard.tsx renders. Everything is computed live from the database, with
 * patient names joined in because vitals/investigations store only patientId.
 */
async function roleDashboard(role) {
  const perms = getSettings()?.rolePermissions?.[role]
  const caps = perms?.can || []
  const stats = {}
  const out = { role, caps, stats }

  const [patients, visits, vitals, investigations, prescriptions, admissions, drugs, payments, walletTxs] = await Promise.all([
    PatientModel.find().lean(), VisitModel.find().lean(), VitalModel.find().lean(),
    InvestigationModel.find().lean(), PrescriptionModel.find().lean(),
    AdmissionModel.find().lean(), DrugModel.find().lean(), PaymentModel.find().lean(),
    WalletTxModel.find().lean(),
  ])
  const byId = new Map(patients.map((p) => [p.id, p]))
  const withName = (row) => ({ ...row, patientName: nameOf(byId.get(row.patientId)) })
  const dayStr = dayPrefix()

  /* ---- Records Officer ---- */
  if (caps.includes('patients.register')) {
    stats.total = patients.length
    stats.active = patients.filter((p) => p.status === 'Active').length
    stats.inactive = patients.filter((p) => p.status !== 'Active').length
    stats.newToday = patients.filter((p) => String(p.registeredAt || p.registered || '').startsWith(dayStr)).length
  }

  /* ---- Doctor: today's clinic ---- */
  if (caps.includes('consultation')) {
    const open = visits.filter((v) => !v.consultation && v.status !== 'Completed')
    stats.today = visits.filter((v) => String(v.createdAt).startsWith(dayStr)).length
    stats.waiting = visits.filter((v) => v.status === 'Waiting' || v.status === 'Open').length
    stats.consults = open.length
    stats.admitted = admissions.filter((a) => a.status === 'Admitted').length

    /* Requirement: once a nurse records vitals the patient shows up here as a
       pending consultation, until a doctor completes one. */
    const vitalsByVisit = new Map()
    vitals.forEach((v) => {
      const prev = vitalsByVisit.get(v.visitId)
      if (!prev || String(v.at) > String(prev.at)) vitalsByVisit.set(v.visitId, v)
    })
    out.pendingConsultations = open
      .filter((v) => vitalsByVisit.has(v.id))
      .sort(byTimeDesc('createdAt'))
      .slice(0, 25)
      .map((v) => {
        const last = vitalsByVisit.get(v.id)
        return { ...withName(v), vitals: `T ${last.temp} · BP ${last.bp} · SpO2 ${last.spo2}`, vitalsAt: last.at }
      })

    out.pendingInv = investigations
      .filter((i) => i.status !== 'Completed')
      .sort(byTimeDesc('createdAt'))
      .slice(0, 25).map(withName)

    out.recent = visits.sort(byTimeDesc('createdAt')).slice(0, 15).map(withName)
  }

  /* ---- Nurse: ward ---- */
  if (caps.includes('vitals')) {
    const admittedNow = admissions.filter((a) => a.status === 'Admitted')
    const attention = vitals.filter((v) => {
      const temp = parseFloat(String(v.temp))
      const sys = parseInt(String(v.bp || '').split('/')[0], 10)
      const spo2 = parseFloat(String(v.spo2))
      return (Number.isFinite(temp) && temp >= 38.5)
        || (Number.isFinite(sys) && sys >= 140)
        || (Number.isFinite(spo2) && spo2 <= 94)
    })
    const wardVisitIds = new Set(admittedNow.map((a) => a.visitId))
    stats.ward = new Set(admittedNow.map((a) => a.patientId)).size
    stats.admitted = admittedNow.length
    stats.attention = attention.length
    stats.medTasks = prescriptions.filter((p) => p.status === 'Pending' && wardVisitIds.has(p.visitId)).length

    out.recentVitals = vitals.sort(byTimeDesc('at')).slice(0, 20).map(withName)

    /* Requirement: patients activated by the Records Officer show up here as
       new patients, until their first vitals are recorded. */
    const seenVitals = new Set(vitals.map((v) => v.patientId))
    out.newPatients = patients
      .filter((p) => p.status === 'Active' && p.activatedAt && !seenVitals.has(p.id))
      .sort(byTimeDesc('activatedAt'))
      .slice(0, 25)
      .map((p) => ({ ...p, patientName: nameOf(p), vitalsTaken: false }))
  }

  /* ---- Laboratory Scientist / Radiologist ---- */
  if (caps.includes('lab.result') || caps.includes('rad.result')) {
    const isRad = caps.includes('rad.result') && !caps.includes('lab.result')
    const mine = investigations.filter((i) => (isRad ? i.dept === 'Radiology' : i.dept !== 'Radiology'))
    stats.pending = mine.filter((i) => i.status === 'Pending').length
    stats.progress = mine.filter((i) => i.status === 'In Progress').length
    stats.completed = mine.filter((i) => i.status === 'Completed').length
    stats.tests = (getSettings()?.investigationTypes || []).length
    if (isRad) stats.reports = mine.filter((i) => i.result && i.result.by).length
    out.requests = mine.sort(byTimeDesc('createdAt')).slice(0, 30).map(withName)
  }

  /* ---- Pharmacist ---- */
  if (caps.includes('rx.dispense')) {
    const rxTotal = (p) => (p.items || []).reduce((t, i) => t + (Number(i.price) || 0) * (Number(i.qty) || 0), 0)
    stats.pending = prescriptions.filter((p) => p.status === 'Pending').length
    stats.dispensed = prescriptions.filter((p) => p.status === 'Dispensed' && String(p.dispensedAt || p.createdAt).startsWith(dayStr)).length
    stats.low = drugs.filter((d) => d.stock > 0 && d.stock < d.minStock).length
    stats.out = drugs.filter((d) => d.stock <= 0).length
    out.rx = prescriptions.sort(byTimeDesc('createdAt')).slice(0, 30)
      .map((p) => ({ ...withName(p), total: rxTotal(p) }))
  }

  /* ---- Accountant ---- */
  if (caps.includes('wallet.fund')) {
    const paid = payments.filter((p) => p.status === 'Paid')
    stats.revenue = sum(paid)
    stats.pending = payments.filter((p) => p.status === 'Pending').length
    stats.completed = paid.length
    stats.funding = sum(walletTxs.filter((t) => t.type === 'Credit' && String(t.at).startsWith(dayStr)))
    out.txs = walletTxs.sort(byTimeDesc('at')).slice(0, 30)
      .map((t) => ({ ...t, patientName: nameOf(byId.get(t.patientId)) }))

    /* Procedure / amount / quantity inventory, so the dashboard can render its
       Inventory card without a second round-trip. Same payload as
       GET /api/services/inventory. */
    try {
      out.procedureInventory = await require('./service.service').inventory()
    } catch (e) {
      /* Never take the whole dashboard down over the inventory card. */
      out.procedureInventory = { items: [], totals: { procedures: 0, quantity: 0, amount: 0, total: 0, billed: 0 } }
    }
  }

  return out
}

/* Hospital-wide stats for the admin console. */
async function hospitalStats() {
  const [patients, staff, visits, payments, prescriptions, investigations, admissions, drugs, walletTxs] = await Promise.all([
    PatientModel.find().lean(), StaffModel.find().lean(), VisitModel.find().lean(),
    PaymentModel.find({ status: 'Paid' }).lean(), PrescriptionModel.find().lean(),
    InvestigationModel.find().lean(), AdmissionModel.find().lean(), DrugModel.find().lean(),
    WalletTxModel.find().lean(),
  ])
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 6)
  const monthAgo = new Date(today); monthAgo.setDate(monthAgo.getDate() - 29)
  const inRange = (rows, from) => rows.filter((r) => { const d = parseWhen(r.at); return d && d >= from })
  const dayPrefixStr = dayPrefix()
  const roleCounts = Object.entries(staff.reduce((acc, s) => { acc[s.role] = (acc[s.role] || 0) + 1; return acc }, {}))
    .sort((a, b) => b[1] - a[1])

  return {
    totalPatients: patients.length,
    active: patients.filter((p) => p.status === 'Active').length,
    inactive: patients.filter((p) => p.status === 'Inactive').length,
    today: visits.filter((v) => String(v.createdAt).startsWith(dayPrefixStr)).length,
    totalStaff: staff.length,
    roleCounts,
    revenueToday: sum(payments.filter((p) => String(p.at).startsWith(dayPrefixStr))),
    revenueWeek: sum(inRange(payments, weekAgo)),
    revenueMonth: sum(inRange(payments, monthAgo)),
    walletFunding: sum(walletTxs.filter((t) => t.type === 'Credit')),
    pendingInvestigations: investigations.filter((i) => i.status !== 'Completed').length,
    admitted: admissions.filter((a) => a.status === 'Admitted').length,
    consultationsToday: visits.filter((v) => v.consultation && String(v.createdAt).startsWith(dayPrefixStr)).length,
    dischargesToday: admissions.filter((a) => a.status === 'Discharged' && String(a.discharge && a.discharge.date).startsWith(dayPrefixStr)).length,
    pendingRx: prescriptions.filter((p) => p.status === 'Pending').length,
    dispensedToday: prescriptions.filter((p) => p.status === 'Dispensed' && String(p.createdAt).startsWith(dayPrefixStr)).length,
    lowStock: drugs.filter((d) => d.stock > 0 && d.stock < d.minStock).length,
    outStock: drugs.filter((d) => d.stock <= 0).length,
  }
}

/** Admin-wide reports for the Reports page: patient, financial, pharmacy,
 *  laboratory and department activity — computed live. `q` filters the
 *  department activity rows (department or action text). */
async function reports(q = '') {
  const [patients, visits, payments, prescriptions, drugs, investigations, admissions, auditRows] = await Promise.all([
    PatientModel.find().lean(), VisitModel.find().lean(), PaymentModel.find({ status: 'Paid' }).lean(),
    PrescriptionModel.find().lean(), DrugModel.find().lean(), InvestigationModel.find().lean(),
    AdmissionModel.find().lean(), AuditModel.find().lean(),
  ])
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 6)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const inRange = (rows, from) => rows.filter((r) => { const d = parseWhen(r.at); return d && d >= from })

  const paid = { daily: sum(inRange(payments, today)), weekly: sum(inRange(payments, weekAgo)), monthly: sum(inRange(payments, monthStart)) }
  const byMethod = payments.reduce((acc, p) => { acc[p.method || 'Other'] = (acc[p.method || 'Other'] || 0) + (Number(p.amount) || 0); return acc }, {})

  const dispensedRx = prescriptions.filter((p) => p.status === 'Dispensed')
  const rxSales = dispensedRx.reduce((t, p) => t + (p.items || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0), 0)

  const lab = investigations.filter((i) => (i.dept || 'Lab') === 'Lab')
  const deptCounts = auditRows.reduce((acc, a) => { acc[a.dept || 'System'] = (acc[a.dept || 'System'] || 0) + 1; return acc }, {})
  let deptActivity = Object.entries(deptCounts).map(([dept, actions]) => ({ dept, actions })).sort((a, b) => b.actions - a.actions)
  const needle = String(q || '').trim().toLowerCase()
  if (needle) {
    deptActivity = deptActivity.filter((d) => d.dept.toLowerCase().includes(needle))
      .concat(auditRows.filter((a) => String(a.action || '').toLowerCase().includes(needle))
        .reduce((acc, a) => { const d = a.dept || 'System'; if (!acc.includes(d)) acc.push(d); return acc }, [])
        .map((dept) => ({ dept, actions: auditRows.filter((a) => (a.dept || 'System') === dept).length }))
        .filter((d) => !deptActivity.some((x) => x.dept === d.dept)))
  }

  const registeredAtOf = (p) => parseWhen(p.registeredAt || p.registered)
  return {
    patient: {
      total: patients.length,
      newMonth: patients.filter((p) => { const d = registeredAtOf(p); return d && d >= monthStart }).length,
      visits: visits.length,
      returning: patients.filter((p) => visits.some((v) => v.patientId === p.id)).length,
      active: patients.filter((p) => p.status === 'Active').length,
      inactive: patients.filter((p) => p.status !== 'Active').length,
      admissions: admissions.length,
      discharges: admissions.filter((a) => a.status === 'Discharged').length,
    },
    financial: { daily: paid.daily, weekly: paid.weekly, monthly: paid.monthly, byMethod },
    pharmacy: {
      dispensed: dispensedRx.length,
      sales: rxSales,
      low: drugs.filter((d) => d.stock > 0 && d.stock < d.minStock).length,
      out: drugs.filter((d) => d.stock <= 0).length,
      pending: prescriptions.filter((p) => p.status === 'Pending').length,
    },
    laboratory: {
      requested: lab.length,
      completed: lab.filter((i) => i.status === 'Completed').length,
      pending: lab.filter((i) => i.status !== 'Completed').length,
    },
    radiology: {
      requested: investigations.filter((i) => i.dept === 'Radiology').length,
      completed: investigations.filter((i) => i.dept === 'Radiology' && i.status === 'Completed').length,
      pending: investigations.filter((i) => i.dept === 'Radiology' && i.status !== 'Completed').length,
    },
    deptActivity,
  }
}

/* Admin-wide patient list enriched with visit counts. */
async function adminPatients() {
  const list = await PatientModel.find().sort('-registeredAt').lean()
  const visits = await VisitModel.find().lean()
  return list.map((p) => ({ ...p, visitCount: visits.filter((v) => v.patientId === p.id).length }))
}

module.exports = { roleDashboard, hospitalStats, reports, adminPatients }
