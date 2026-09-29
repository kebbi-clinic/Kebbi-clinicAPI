/* Validation schema — system settings & role permissions. */
const { body } = require('express-validator')

const updateSettings = [
  body('hospital.name').optional({ values: 'falsy' }).isString(),
  body('hospital.email').optional({ values: 'falsy' }).isEmail().withMessage('Hospital email is not valid'),
  body('investigationTypes').optional().isArray(),
  body('drugCategories').optional().isArray(),
  body('paymentMethods').optional().isArray(),
]

const updatePermissions = [
  body('matrix').optional().isObject().withMessage('matrix must be an object of role → { can, cannot }'),
]

module.exports = { updateSettings, updatePermissions }
