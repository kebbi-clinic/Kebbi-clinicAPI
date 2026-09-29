/* Auth controller. */
const { asyncHandler } = require('../utils/asyncHandler')
const authService = require('../services/auth.service')

exports.login = asyncHandler(async (req, res) => res.json(await authService.login(req.body)))

exports.changePassword = asyncHandler(async (req, res) =>
  res.json(await authService.changePassword({ userId: req.user.id, currentPassword: req.body.currentPassword, newPassword: req.body.newPassword })))
