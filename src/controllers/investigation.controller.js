/* Laboratory & radiology controller. */
const { asyncHandler } = require('../utils/asyncHandler')
const investigationService = require('../services/investigation.service')

exports.list = asyncHandler(async (req, res) => res.json(await investigationService.list(req.query.dept)))
exports.saveResult = asyncHandler(async (req, res) => res.json(await investigationService.saveResult(req.params.id, req.file, req.body, req.user)))
