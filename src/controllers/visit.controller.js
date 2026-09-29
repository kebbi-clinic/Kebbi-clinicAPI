/* Visit & consultation controller. */
const { asyncHandler } = require('../utils/asyncHandler')
const visitService = require('../services/visit.service')

exports.get = asyncHandler(async (req, res) => res.json(await visitService.getVisit(req.params.id)))
exports.consultation = asyncHandler(async (req, res) => res.json(await visitService.completeConsultation(req.params.id, req.body, req.user)))
