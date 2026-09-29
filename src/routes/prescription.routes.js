const { Router } = require('express')
const controller = require('../controllers/pharmacy.controller')
const { requireAuth, requirePerm } = require('../middleware/auth.middleware')
const { validate } = require('../middleware/validate')
const { dispense } = require('../validators/pharmacy.validator')

const router = Router()
router.use(requireAuth)

router.get('/', controller.listAllPrescriptions)
router.get('/:patientId', controller.listPrescriptions)
router.post('/:id/dispense', requirePerm('rx.dispense'), validate(dispense), controller.dispense)

module.exports = router
