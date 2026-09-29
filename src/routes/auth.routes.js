const { Router } = require('express')
const { login, changePassword } = require('../controllers/auth.controller')
const { validate } = require('../middleware/validate')
const { requireAuth } = require('../middleware/auth.middleware')
const { login: loginRules, changePassword: changePasswordRules } = require('../validators/staff.validator')

const router = Router()

/* Public endpoint — the only route that does not require a JWT. */
router.post('/login', validate(loginRules), login)

/* Self-service password change (also used to clear "must change at first login"). */
router.post('/change-password', requireAuth, validate(changePasswordRules), changePassword)

module.exports = router
