/* Dashboard & settings controller. */
const { asyncHandler } = require('../utils/asyncHandler')
const { StaffModel } = require('../models')
const { ROLES, CAPS } = require('../constants')
const { getIo } = require('../sockets/socket')
const dashboardService = require('../services/dashboard.service')
const settingsService = require('../services/settings.service')

exports.dashboard = asyncHandler(async (req, res) => res.json(await dashboardService.roleDashboard(req.user.role)))

exports.getSettings = asyncHandler(async (_req, res) => res.json(settingsService.get()))
exports.updateSettings = asyncHandler(async (req, res) => res.json(await settingsService.update(req.body, req.user)))

exports.getPermissions = asyncHandler(async (_req, res) => {
  const matrix = settingsService.get()?.rolePermissions || {}
  const counts = {}
  for (const role of ROLES) { counts[role] = await StaffModel.countDocuments({ role }) }
  res.json({ matrix, counts, caps: CAPS })
})
exports.updatePermissions = asyncHandler(async (req, res) => {
  const result = await settingsService.updatePermissions(req.body?.matrix || req.body, req.user)
  const io = getIo(); if (io) io.emit('permissions.changed', result.matrix)
  res.json(result)
})
