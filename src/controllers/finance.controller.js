/* Finance controller — payments & wallets. */
const { asyncHandler } = require('../utils/asyncHandler')
const financeService = require('../services/finance.service')

exports.listPayments = asyncHandler(async (_req, res) => res.json(await financeService.listPayments()))
exports.listWalletTxs = asyncHandler(async (_req, res) => res.json(await financeService.listWalletTxs()))
exports.fundWallet = asyncHandler(async (req, res) => res.json(await financeService.fundWallet(req.body, req.user)))
