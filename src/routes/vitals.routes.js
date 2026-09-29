const { Router } = require('express')
const controller = require('../controllers/nursing.controller')
const { requireAuth, requirePerm } = require('../middleware/auth.middleware')
const { validate } = require('../middleware/validate')
const { createVitals } = require('../validators/clinical.validator')

const router = Router()
router.use(requireAuth)

router.get('/:patientId', controller.listVitals)
router.post('/', requirePerm('vitals'), validate(createVitals), controller.createVitals)

module.exports = router
