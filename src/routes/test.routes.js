/* Laboratory & radiology test catalogue routes — the investigation inventory.
 * Reads are open to every signed-in staff member (doctors need the list to
 * raise requests); writes need `tests.manage` (admin, lab scientist, radiologist). */
const { Router } = require('express')
const controller = require('../controllers/test.controller')
const { requireAuth, requirePerm } = require('../middleware/auth.middleware')
const { validate } = require('../middleware/validate')
const { createTest, updateTest, testId } = require('../validators/pharmacy.validator')

const router = Router()
router.use(requireAuth)

router.get('/', controller.list)
router.post('/', requirePerm('tests.manage', 'admin.settings'), validate(createTest), controller.create)
router.put('/:id', requirePerm('tests.manage', 'admin.settings'), validate(updateTest), controller.update)
/* Deleting a catalogue entry only removes it from future pickers — existing
   requests and already-uploaded results keep their historical price. */
router.delete('/:id', requirePerm('tests.manage', 'admin.settings'), validate(testId), controller.remove)

module.exports = router