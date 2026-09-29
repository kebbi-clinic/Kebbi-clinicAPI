/* Dashboard service — role-specific counters computed live from the database,
 * plus hospital-wide stats for the Admin app. */
const { PatientModel, StaffModel, VisitModel, PaymentModel, PrescriptionModel,
        InvestigationModel, AdmissionModel, DrugModel, WalletTxModel, AuditModel, clean } = require('../models')
const { getSettings } = require('../config/db')
const { now, parseWhen, dayPrefix } = require('../utils/datetime')

async function roleDashboard(role) {
  const perms = getSettings()?.rolePermissions?.[role]
  const caps = perms?.can || []
  const dash = {}
  if (caps.includes('patients.register')) dash.totalPatients = await PatientModel.countDocuments({})
  if (caps.includes('visits.start')) dash.todayVisits = await VisitModel.countDocuments({ createdAt: { $regex: now().split(' ·')[0] } })
  if (caps.includes('consultation')) dash.pendingInvs = await InvestigationModel.countDocuments({ status: { $ne: 'Completed' } })
  if (caps.includes('rx.dispense')) dash.pendingRx = await PrescriptionModel.countDocuments({ status: 'Pending' })
  if (caps.includes('wallet.fund')) dash.pendingPayments = (await PaymentModel.find({ status: 'Pending' })).length
  return { role, caps, dashboard: dash }
}

const sum = (rows) => rows.reduce((t, r) => t + (Number(r.amount) || 0), 0)

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
