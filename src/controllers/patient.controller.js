/* Patient controller. */
const { asyncHandler } = require('../utils/asyncHandler')
const patientService = require('../services/patient.service')

exports.list = asyncHandler(async (req, res) => res.json(await patientService.list(req.user.role, {
  status: req.query.status, q: req.query.q, page: req.query.page, limit: req.query.limit,
})))
exports.register = asyncHandler(async (req, res) => res.status(201).json(await patientService.register(req.body, req.user)))
exports.get = asyncHandler(async (req, res) => res.json(await patientService.getBasic(req.params.id)))
exports.startVisit = asyncHandler(async (req, res) => res.status(201).json(await patientService.startVisit(req.params.id, req.user)))
exports.setStatus = asyncHandler(async (req, res) => res.json(await patientService.setStatus(req.params.id, req.body.status, req.user)))
/* Dedicated activation endpoint — only roles holding `patients.activate`
   (the Records Officer, plus administrators) can reach it. */
exports.activate = asyncHandler(async (req, res) => res.json(await patientService.activate(req.params.id, req.user)))
