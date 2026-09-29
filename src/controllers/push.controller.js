/* Web Push controller — key distribution + subscription lifecycle. */
const { asyncHandler } = require('../utils/asyncHandler')
const pushService = require('../services/push.service')

exports.publicKey = asyncHandler(async (_req, res) => {
  res.json({ publicKey: await pushService.publicKey() })
})
exports.subscribe = asyncHandler(async (req, res) => {
  await pushService.subscribe(req.user, req.body)
  res.json({ ok: true })
})
exports.unsubscribe = asyncHandler(async (req, res) => {
  await pushService.unsubscribe(req.body && req.body.endpoint)
  res.json({ ok: true })
})
