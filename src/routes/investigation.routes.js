const { Router } = require('express')
const multer = require('multer')
const controller = require('../controllers/investigation.controller')
const { requireAuth, requirePerm } = require('../middleware/auth.middleware')
const { validate } = require('../middleware/validate')
const { investigationId } = require('../validators/clinical.validator')
const { upload } = require('../middleware/upload.middleware')

const router = Router()
router.use(requireAuth)

router.get('/', controller.list)
router.post('/:id/result', requirePerm('lab.result', 'rad.result'), upload.single('image'), validate(investigationId), controller.saveResult)

module.exports = router
