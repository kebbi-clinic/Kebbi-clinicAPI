const { Router } = require('express')
const controller = require('../controllers/nursing.controller')
const { requireAuth, requirePerm } = require('../middleware/auth.middleware')
const { validate } = require('../middleware/validate')
const { discharge } = require('../validators/clinical.validator')

const router = Router()
router.use(requireAuth)

router.get('/', controller.listAdmissions)
router.post('/:id/discharge', requirePerm('discharge'), validate(discharge), controller.discharge)

module.exports = router
