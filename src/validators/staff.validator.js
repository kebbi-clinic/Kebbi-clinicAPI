/* Validation schemas — auth & staff administration. */
const { body, param } = require('express-validator')
const { ROLES, CAPS } = require('../constants')

const login = [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required'),
]

const createStaff = [
  body('firstName').trim().notEmpty().withMessage('First name is required').isLength({ max: 60 }),
  body('surname').trim().notEmpty().withMessage('Surname is required').isLength({ max: 60 }),
  body('username').trim().notEmpty().withMessage('Username is required')
    .matches(/^[a-z0-9._-]{3,30}$/i).withMessage('Username may only contain letters, digits, dot, underscore or dash (3–30 chars)'),
  body('role').isIn(ROLES).withMessage(`Role must be one of: ${ROLES.join(', ')}`),
  body('phone').optional({ values: 'falsy' }).matches(/^[0-9+\-\s()]{7,20}$/).withMessage('Phone number is not valid'),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('Email is not valid').normalizeEmail(),
  body('password').optional({ values: 'falsy' }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('app').optional().isIn(['hospital', 'admin']).withMessage('App must be hospital or admin'),
  body('status').optional({ values: 'falsy' }).trim().customSanitizer((v) => (typeof v === 'string' && v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : v)).isIn(['Active', 'Inactive']).withMessage('Status must be Active or Inactive'),
  body('mustChangePassword').optional().toBoolean({ fallback: false }),
  /* Per-account capability override (scoped admin accounts). */
  body('caps').optional({ values: 'null' }).isArray({ max: 40 }).withMessage('caps must be an array')
    .bail().custom((arr) => {
      const bad = (Array.isArray(arr) ? arr : []).filter((c) => !CAPS[c])
      if (bad.length) throw new Error(`Unknown capabilities: ${bad.join(', ')}`)
      return true
    }),
]

const updateStaff = [
  param('id').trim().notEmpty().withMessage('Staff id is required'),
  body('role').optional().isIn(ROLES).withMessage(`Role must be one of: ${ROLES.join(', ')}`),
  body('password').optional({ values: 'falsy' }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('mustChangePassword').optional().toBoolean({ fallback: false }),
  body('status').optional({ values: 'falsy' }).trim().customSanitizer((v) => (typeof v === 'string' && v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : v)).isIn(['Active', 'Inactive']).withMessage('Status must be Active or Inactive'),
  body('phone').optional({ values: 'falsy' }).matches(/^[0-9+\-\s()]{7,20}$/).withMessage('Phone number is not valid'),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('Email is not valid').normalizeEmail(),
  body('caps').optional({ values: 'null' }).isArray({ max: 40 }).withMessage('caps must be an array')
    .bail().custom((arr) => {
      const bad = (Array.isArray(arr) ? arr : []).filter((c) => !CAPS[c])
      if (bad.length) throw new Error(`Unknown capabilities: ${bad.join(', ')}`)
      return true
    }),
]

const changeRole = [
  param('username').trim().notEmpty().withMessage('Username is required'),
  body('role').isIn(ROLES).withMessage(`Role must be one of: ${ROLES.join(', ')}`),
]

const changePassword = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
    .custom((v, { req }) => (v === req.body.currentPassword ? Promise.reject(new Error('New password must be different from the current one')) : true)),
]

module.exports = { login, createStaff, updateStaff, changeRole, changePassword }
