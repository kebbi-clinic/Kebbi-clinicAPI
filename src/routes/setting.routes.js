const { Router } = require('express')
const controller = require('../controllers/settings.controller')
const { requireAuth } = require('../middleware/auth.middleware')

const router = Router()
router.use(requireAuth)

/* Mounted at /api/settings — the only admin app + hospital app read endpoint. */
router.get('/', controller.getSettings)

module.exports = router
