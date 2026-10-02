/* Staff administration controller. */
const { asyncHandler } = require('../utils/asyncHandler')
const staffService = require('../services/staff.service')
const { onlineUsers } = require('../sockets/socket')

exports.list = asyncHandler(async (_req, res) => res.json(await staffService.list()))
exports.create = asyncHandler(async (req, res) => res.status(201).json(await staffService.create(req.body, req.user)))
exports.update = asyncHandler(async (req, res) => res.json(await staffService.update(req.params.id, req.body, req.user)))
exports.changeRole = asyncHandler(async (req, res) => res.json(await staffService.changeRole(req.params.username, req.body.role, req.user)))
/** Permanently remove a staff record (not a soft deactivate). */
exports.remove = asyncHandler(async (req, res) => res.json(await staffService.remove(req.params.id, req.user)))
/** Live presence: staff with an open (authenticated) app session right now. */
exports.online = asyncHandler(async (_req, res) => res.json(onlineUsers()))
