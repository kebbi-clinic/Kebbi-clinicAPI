const { Router } = require('express')
const controller = require('../controllers/patient.controller')
const { requireAuth, requirePerm } = require('../middleware/auth.middleware')
const { validate } = require('../middleware/validate')
const { registerPatient, listPatients, startVisit, patientStatus } = require('../validators/patient.validator')

const router = Router()
router.use(requireAuth)

router.get('/', validate(listPatients), controller.list)
router.post('/', requirePerm('patients.register'), validate(registerPatient), controller.register)
router.get('/:id', controller.get)
router.post('/:id/visits', requirePerm('visits.start'), validate(startVisit), controller.startVisit)
/* Activation is restricted to `patients.activate` (Records Officer). The status
   endpoint deliberately cannot be used to activate — it needs `patients.status`,
   which the Records Officer holds, so activation always runs the wallet charge. */
router.post('/:id/activate', requirePerm('patients.activate'), controller.activate)
router.post('/:id/status', requirePerm('patients.status'), validate(patientStatus), controller.setStatus)

module.exports = router
