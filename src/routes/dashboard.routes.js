const { Router } = require('express')
const controller = require('../controllers/settings.controller')
const { requireAuth } = require('../middleware/auth.middleware')

const router = Router()
router.use(requireAuth)

router.get('/', controller.dashboard)

module.exports = router
