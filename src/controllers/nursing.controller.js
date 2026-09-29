/* Nursing controller — vitals & admissions. */
const { asyncHandler } = require('../utils/asyncHandler')
const nursingService = require('../services/nursing.service')

exports.listVitals = asyncHandler(async (req, res) => res.json(await nursingService.listVitals(req.params.patientId)))
exports.createVitals = asyncHandler(async (req, res) => res.status(201).json(await nursingService.createVitals(req.body, req.user)))
exports.listAdmissions = asyncHandler(async (_req, res) => res.json(await nursingService.listAdmissions()))
exports.discharge = asyncHandler(async (req, res) => res.json(await nursingService.discharge(req.params.id, req.body, req.user)))
