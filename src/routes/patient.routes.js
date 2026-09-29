const { Router } = require('express')
const controller = require('../controllers/patient.controller')
const { requireAuth, requirePerm } = require('../middleware/auth.middleware')
const { validate } = require('../middleware/validate')
const { registerPatient, startVisit, patientStatus } = require('../validators/patient.validator')

const router = Router()
router.use(requireAuth)

router.get('/', controller.list)
router.post('/', requirePerm('patients.register'), validate(registerPatient), controller.register)
router.get('/:id', controller.get)
router.post('/:id/visits', requirePerm('visits.start'), validate(startVisit), controller.startVisit)
router.post('/:id/status', requirePerm('patients.status'), validate(patientStatus), controller.setStatus)

module.exports = router
