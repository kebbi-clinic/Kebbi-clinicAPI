const { Router } = require('express')
const controller = require('../controllers/staff.controller')
const { requireAuth, requirePerm } = require('../middleware/auth.middleware')
const { validate } = require('../middleware/validate')
const { createStaff, updateStaff, changeRole } = require('../validators/staff.validator')

const router = Router()
/* Reads and edits need staff administration rights… */
router.use(requireAuth, requirePerm('admin.staff', 'staff.manage'))

router.get('/', controller.list)
router.post('/', validate(createStaff), controller.create)
router.put('/:id', validate(updateStaff), controller.update)
router.put('/:username/role', validate(changeRole), controller.changeRole)

/* …but a permanent delete additionally requires the `staff.delete` capability,
   which is granted to administrator roles only. */
router.delete('/:id', requireAuth, requirePerm('staff.delete'), controller.remove)

module.exports = router
