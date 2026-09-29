const { Router } = require('express')
const controller = require('../controllers/pharmacy.controller')
const { requireAuth, requirePerm } = require('../middleware/auth.middleware')
const { validate } = require('../middleware/validate')
const { createDrug, updateDrug } = require('../validators/pharmacy.validator')

const router = Router()
router.use(requireAuth)

router.get('/', controller.listDrugs)
router.post('/', requirePerm('inventory.manage'), validate(createDrug), controller.createDrug)
router.put('/:id', requirePerm('inventory.manage'), validate(updateDrug), controller.updateDrug)

module.exports = router
