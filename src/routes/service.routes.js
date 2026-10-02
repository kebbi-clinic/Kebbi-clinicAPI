const { Router } = require('express')
const controller = require('../controllers/service.controller')
const { requireAuth, requirePerm } = require('../middleware/auth.middleware')
const { validate } = require('../middleware/validate')
const { createService, updateService, performService } = require('../validators/pharmacy.validator')

const router = Router()
router.use(requireAuth)

/* Reading the catalogue: every authenticated staff member may see it. */
router.get('/', controller.list)
router.get('/patient/:patientId', controller.forPatient)
/* Performing a service is a nursing / doctor action and bills the patient. */
router.post('/perform', requirePerm('services.record'), validate(performService), controller.perform)
/* Creating and pricing services is an administration action. */
router.post('/', requirePerm('services.manage'), validate(createService), controller.create)
router.put('/:id', requirePerm('services.manage'), validate(updateService), controller.update)

module.exports = router