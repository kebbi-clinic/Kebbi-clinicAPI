const { Router } = require('express')
const controller = require('../controllers/notification.controller')
const { requireAuth } = require('../middleware/auth.middleware')

const router = Router()
router.use(requireAuth)

router.get('/', controller.myNotifications)
router.post('/read', controller.readMyNotifications)

module.exports = router
