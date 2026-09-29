/* Patient controller. */
const { asyncHandler } = require('../utils/asyncHandler')
const patientService = require('../services/patient.service')

exports.list = asyncHandler(async (_req, res) => res.json(await patientService.list()))
exports.register = asyncHandler(async (req, res) => res.status(201).json(await patientService.register(req.body, req.user)))
exports.get = asyncHandler(async (req, res) => res.json(await patientService.getBasic(req.params.id)))
exports.startVisit = asyncHandler(async (req, res) => res.status(201).json(await patientService.startVisit(req.params.id, req.user)))
exports.setStatus = asyncHandler(async (req, res) => res.json(await patientService.setStatus(req.params.id, req.body.status, req.user)))
