/* Activity feed controller. */
const { asyncHandler } = require('../utils/asyncHandler')
const activityService = require('../services/activity.service')

exports.list = asyncHandler(async (req, res) => res.json(await activityService.list(req.query)))
exports.byPatient = asyncHandler(async (req, res) => res.json(await activityService.byPatient(req.params.patientId)))
exports.create = asyncHandler(async (req, res) => res.status(201).json(await activityService.create(req.body, req.user)))
