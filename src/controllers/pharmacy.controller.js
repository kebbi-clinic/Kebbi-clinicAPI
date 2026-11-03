/* Pharmacy controller — prescriptions, inventory & over-the-counter sales. */
const { asyncHandler } = require('../utils/asyncHandler')
const pharmacyService = require('../services/pharmacy.service')

exports.listPrescriptions = asyncHandler(async (req, res) => res.json(await pharmacyService.listPrescriptions(req.params.patientId)))
exports.listAllPrescriptions = asyncHandler(async (_req, res) => res.json(await pharmacyService.listPrescriptions()))
exports.dispense = asyncHandler(async (req, res) => res.json(await pharmacyService.dispense(req.params.id, req.body, req.user)))
exports.listDrugs = asyncHandler(async (_req, res) => res.json(await pharmacyService.listDrugs()))
exports.createDrug = asyncHandler(async (req, res) => res.status(201).json(await pharmacyService.createDrug(req.body, req.user)))
exports.updateDrug = asyncHandler(async (req, res) => res.json(await pharmacyService.updateDrug(req.params.id, req.body, req.user)))

exports.createOTCSale = asyncHandler(async (req, res) => res.status(201).json(await pharmacyService.createOTCSale(req.body, req.user)))
exports.markOTCSalePaid = asyncHandler(async (req, res) => res.json(await pharmacyService.markOTCSalePaid(req.params.id, req.body, req.user)))
exports.listOTCSales = asyncHandler(async (_req, res) => res.json(await pharmacyService.listOTCSales()))
exports.getOTCSale = asyncHandler(async (req, res) => res.json(await pharmacyService.getOTCSale(req.params.id)))
