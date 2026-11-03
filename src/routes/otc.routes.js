const { Router } = require('express')
const controller = require('../controllers/pharmacy.controller')
const { requireAuth, requirePerm } = require('../middleware/auth.middleware')
const { validate } = require('../middleware/validate')
const { createOTCSale, payOTCSale } = require('../validators/pharmacy.validator')

const router = Router()
router.use(requireAuth)

/* Pharmacist rings up a walk-in (non-patient) cash sale as Pending — the
 * customer receives the sale id and pays the accountant later. */
router.post('/sales', requirePerm('rx.dispense'), validate(createOTCSale), controller.createOTCSale)
router.get('/sales', requirePerm('rx.dispense'), controller.listOTCSales)
router.get('/sales/:id', requirePerm('rx.dispense'), controller.getOTCSale)

/* Accountant marks a Pending sale Paid with a payment method — stock moves
 * and the receipt is released only once this is done. */
router.post('/sales/:id/pay', requirePerm('wallet.fund'), validate(payOTCSale), controller.markOTCSalePaid)

module.exports = router
