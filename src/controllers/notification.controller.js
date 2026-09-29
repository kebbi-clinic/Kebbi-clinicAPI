/* Notifications, audit, reports & uploads controller. */
const { asyncHandler } = require('../utils/asyncHandler')
const { AuditModel, NotificationModel, cleanList } = require('../models')
const { uploadResult } = require('../services/storage.service')
const dashboardService = require('../services/dashboard.service')
const patientService = require('../services/patient.service')

/* Role-targeted (hospital app). */
exports.myNotifications = asyncHandler(async (req, res) => {
  const role = req.user.role
  const rows = role === 'Super Admin' || role === 'Hospital Administrator'
    ? await NotificationModel.find().sort('-at').limit(200)
    : await NotificationModel.find({ role }).sort('-at').limit(200)
  res.json(cleanList(rows))
})
exports.readMyNotifications = asyncHandler(async (req, res) => {
  await NotificationModel.updateMany({ role: req.user.role, read: false }, { read: true })
  res.json({ ok: true })
})

/* Admin-wide. */
exports.listAudit = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim()
  let filter = {}
  if (q) {
    /* Escape regex metacharacters so a stray "(" in the search box cannot crash the query. */
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter = { $or: [{ who: rx }, { action: rx }, { target: rx }, { extra: rx }, { dept: rx }] }
  }
  if (req.query.who) filter.who = req.query.who
  res.json(cleanList(await AuditModel.find(filter).sort('-when').limit(2000)))
})
exports.listAllNotifications = asyncHandler(async (_req, res) => res.json(cleanList(await NotificationModel.find().sort('-at').limit(200))))
exports.readAllNotifications = asyncHandler(async (_req, res) => {
  await NotificationModel.updateMany({ read: false }, { read: true })
  res.json({ ok: true })
})
exports.reports = asyncHandler(async (req, res) => res.json(await dashboardService.reports(req.query.q)))
exports.stats = asyncHandler(async (_req, res) => res.json(await dashboardService.hospitalStats()))
exports.adminPatients = asyncHandler(async (_req, res) => res.json(await dashboardService.adminPatients()))
exports.adminPatient = asyncHandler(async (req, res) => res.json(await patientService.get360(req.params.id)))

/* Uploads. */
exports.uploadFile = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' })
  const url = await uploadResult(req.file, req.file.buffer)
  res.json({ url })
})
