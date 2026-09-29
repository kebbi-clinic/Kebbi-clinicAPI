const { Router } = require('express')
const controller = require('../controllers/activity.controller')
const { requireAuth } = require('../middleware/auth.middleware')
const { validate } = require('../middleware/validate')
const { createActivity } = require('../validators/finance.validator')

const router = Router()
router.use(requireAuth)

router.get('/', controller.list)
router.get('/:patientId', controller.byPatient)
router.post('/', validate(createActivity), controller.create)

module.exports = router
