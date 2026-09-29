const { Router } = require('express')
const controller = require('../controllers/notification.controller')
const settingsController = require('../controllers/settings.controller')
const staffController = require('../controllers/staff.controller')
const { requireAuth, requirePerm } = require('../middleware/auth.middleware')
const { validate } = require('../middleware/validate')
const { updateSettings, updatePermissions } = require('../validators/settings.validator')

const router = Router()
router.use(requireAuth)

/* Page-scoped permissions: admins without a per-account caps override pass
   anything; scoped sub-admins only pass the `admin.*` capabilities they were
   granted when their account was created. */
router.get('/audit', requirePerm('admin.audit', 'reports.view'), controller.listAudit)
router.get('/reports', requirePerm('admin.reports', 'reports.view'), controller.reports)
router.get('/stats', requirePerm('admin.reports', 'reports.view'), controller.stats)
router.get('/patients', requirePerm('admin.patients', 'reports.view', 'patients.register'), controller.adminPatients)
router.get('/patients/:id', requirePerm('admin.patients', 'reports.view', 'patients.register'), controller.adminPatient)
router.get('/notifications', requirePerm('admin.staff', 'staff.manage'), controller.listAllNotifications)
router.post('/notifications/read', requirePerm('admin.staff', 'staff.manage'), controller.readAllNotifications)
/* Who is online right now (live presence). */
router.get('/presence', requirePerm('admin.staff', 'staff.manage', 'reports.view'), staffController.online)

/* Hospital settings & the role-permission matrix (admin app). */
router.put('/settings', requirePerm('admin.settings', 'settings.manage'), validate(updateSettings), settingsController.updateSettings)
router.get('/permissions', requirePerm('admin.settings', 'admin.staff', 'settings.manage'), settingsController.getPermissions)
router.put('/permissions', requirePerm('admin.settings', 'settings.manage'), settingsController.updatePermissions)

module.exports = router
