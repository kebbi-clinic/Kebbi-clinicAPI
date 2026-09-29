const { Router } = require('express')
const controller = require('../controllers/visit.controller')
const { requireAuth, requirePerm } = require('../middleware/auth.middleware')
const { validate } = require('../middleware/validate')
const { consultation } = require('../validators/clinical.validator')

const router = Router()
router.use(requireAuth)

router.get('/:id', controller.get)
router.post('/:id/consultation', requirePerm('consultation'), validate(consultation), controller.consultation)

module.exports = router
