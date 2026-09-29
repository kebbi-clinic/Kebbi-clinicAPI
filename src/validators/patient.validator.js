/* Validation schemas — patients & visits. */
const { body, param } = require('express-validator')

const registerPatient = [
  body('firstName').trim().notEmpty().withMessage('First name is required').isLength({ max: 60 }),
  body('surname').trim().notEmpty().withMessage('Surname is required').isLength({ max: 60 }),
  body('dob').notEmpty().withMessage('Date of birth is required').isString(),
  body('gender').trim().notEmpty().withMessage('Gender is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required')
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('Phone number is not valid'),
  body('address').trim().notEmpty().withMessage('Address is required').isLength({ max: 200 }),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('Email is not valid').normalizeEmail(),
  body('nextOfKin.name').optional({ values: 'null' }).isString().isLength({ max: 120 }),
  body('nextOfKin.phone').optional({ values: 'null' }).matches(/^[0-9+\-\s()]{7,20}$/).withMessage('Next-of-kin phone is not valid'),
]

const startVisit = [
  param('id').trim().notEmpty().withMessage('Patient id is required'),
]

const patientStatus = [
  param('id').trim().notEmpty().withMessage('Patient id is required'),
  body('status').isIn(['Active', 'Inactive']).withMessage('Status must be Active or Inactive'),
]

module.exports = { registerPatient, startVisit, patientStatus }
