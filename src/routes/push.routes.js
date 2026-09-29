const { Router } = require('express')
const controller = require('../controllers/push.controller')
const { requireAuth } = require('../middleware/auth.middleware')

const router = Router()
router.use(requireAuth)

router.get('/public-key', controller.publicKey)
router.post('/subscribe', controller.subscribe)
router.post('/unsubscribe', controller.unsubscribe)

module.exports = router
