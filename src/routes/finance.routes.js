const { Router } = require('express')
const controller = require('../controllers/finance.controller')
const { requireAuth, requirePerm } = require('../middleware/auth.middleware')
const { validate } = require('../middleware/validate')
const { walletFund } = require('../validators/finance.validator')

const router = Router()
router.use(requireAuth)

router.get('/payments', controller.listPayments)
router.get('/wallettxs', controller.listWalletTxs)
router.post('/wallet/fund', requirePerm('wallet.fund'), validate(walletFund), controller.fundWallet)

module.exports = router
