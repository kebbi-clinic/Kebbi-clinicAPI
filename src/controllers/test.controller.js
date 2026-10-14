/* Laboratory & radiology test catalogue controller (inventory & prices). */
const { asyncHandler } = require('../utils/asyncHandler')
const testService = require('../services/test.service')

exports.list = asyncHandler(async (req, res) => res.json(await testService.list(req.query.dept)))
exports.create = asyncHandler(async (req, res) => res.status(201).json(await testService.create(req.body, req.user)))
exports.update = asyncHandler(async (req, res) => res.json(await testService.update(req.params.id, req.body, req.user)))
exports.remove = asyncHandler(async (req, res) => res.json(await testService.remove(req.params.id, req.user)))