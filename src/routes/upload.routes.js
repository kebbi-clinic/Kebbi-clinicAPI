const { Router } = require('express')
const controller = require('../controllers/notification.controller')
const { requireAuth } = require('../middleware/auth.middleware')
const { upload } = require('../middleware/upload.middleware')

const router = Router()
router.use(requireAuth)

router.post('/', upload.single('image'), controller.uploadFile)

module.exports = router
