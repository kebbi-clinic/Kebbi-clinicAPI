/* Procedures / services controller. */
const { asyncHandler } = require('../utils/asyncHandler')
const serviceService = require('../services/service.service')

exports.list = asyncHandler(async (req, res) =>
  res.json(await serviceService.list(req.query.all === '1' || req.query.all === 'true')))
exports.create = asyncHandler(async (req, res) => res.status(201).json(await serviceService.create(req.body, req.user)))
exports.update = asyncHandler(async (req, res) => res.json(await serviceService.update(req.params.id, req.body, req.user)))
exports.remove = asyncHandler(async (req, res) => res.json(await serviceService.remove(req.params.id, req.user)))
exports.perform = asyncHandler(async (req, res) => res.status(201).json(await serviceService.perform(req.body, req.user)))
exports.forPatient = asyncHandler(async (req, res) => res.json(await serviceService.listForPatient(req.params.patientId)))
exports.inventory = asyncHandler(async (req, res) => res.json(await serviceService.inventory()))