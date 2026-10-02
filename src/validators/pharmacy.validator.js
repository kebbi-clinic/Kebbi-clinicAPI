/* Validation schemas — pharmacy: inventory & dispensing. */
const { body, param } = require('express-validator')
const { getSettings } = require('../config/db')

const createDrug = [
  body('name').trim().notEmpty().withMessage('Drug name is required').isLength({ max: 120 }),
  body('price').notEmpty().withMessage('Price is required').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('category').optional({ values: 'falsy' }).isString(),
  body('unit').optional({ values: 'falsy' }).isString(),
  body('stock').optional().isInt({ min: 0 }).withMessage('Stock must be a whole number ≥ 0'),
  body('minStock').optional().isInt({ min: 0 }).withMessage('Minimum stock must be a whole number ≥ 0'),
  body('expiry').optional({ values: 'falsy' }).isString(),
]

const updateDrug = [
  param('id').trim().notEmpty().withMessage('Drug id is required'),
  body('name').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
  body('price').optional({ values: 'null' }).isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('stock').optional({ values: 'null' }).isInt({ min: 0 }).withMessage('Stock must be a whole number ≥ 0'),
  body('minStock').optional({ values: 'null' }).isInt({ min: 0 }).withMessage('Minimum stock must be a whole number ≥ 0'),
  body('category').optional({ values: 'falsy' }).isString(),
  body('unit').optional({ values: 'falsy' }).isString(),
  body('expiry').optional({ values: 'falsy' }).isString(),
]

const dispense = [
  param('id').trim().notEmpty().withMessage('Prescription id is required'),
  body('method').optional().custom((v) => {
    const methods = getSettings()?.paymentMethods || ['Wallet', 'Cash', 'Transfer', 'POS']
    if (!methods.includes(v)) throw new Error(`Payment method must be one of: ${methods.join(', ')}`)
    return true
  }),
]

/* Validation schemas — procedures & services (the priced catalogue an admin
 * creates and nurses/doctors perform). */

const serviceId = [
  param('id').trim().notEmpty().withMessage('Service id is required'),
]

const createService = [
  body('name').trim().notEmpty().withMessage('Service name is required').isLength({ max: 120 }),
  body('amount').notEmpty().withMessage('Amount is required')
    .isFloat({ min: 0 }).withMessage('Amount must be zero or more'),
  body('category').optional({ values: 'falsy' }).isString().isLength({ max: 60 }),
  body('department').optional({ values: 'falsy' }).isString().isLength({ max: 60 }),
  body('notes').optional({ values: 'falsy' }).isString().isLength({ max: 500 }),
  body('active').optional().isBoolean().withMessage('active must be true or false'),
]

const updateService = [
  ...serviceId,
  body('name').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
  body('amount').optional({ values: 'null' }).isFloat({ min: 0 }).withMessage('Amount must be zero or more'),
  body('category').optional({ values: 'falsy' }).isString().isLength({ max: 60 }),
  body('department').optional({ values: 'falsy' }).isString().isLength({ max: 60 }),
  body('notes').optional({ values: 'falsy' }).isString().isLength({ max: 500 }),
  body('active').optional().isBoolean().withMessage('active must be true or false'),
]

/* Recording a service that was actually performed on a patient. */
const performService = [
  body('patientId').trim().notEmpty().withMessage('Select a patient first'),
  body('serviceId').trim().notEmpty().withMessage('Select a procedure or service'),
  body('notes').optional({ values: 'falsy' }).isString().isLength({ max: 500 }),
  /* Charge from the wallet by default; a cash/transfer settlement is recorded
     as a pending payment for the accountant instead. */
  body('settle').optional().isIn(['Wallet', 'Cash', 'Transfer', 'POS'])
    .withMessage('Settlement must be Wallet, Cash, Transfer or POS'),
]

module.exports = { createDrug, updateDrug, dispense, createService, updateService, performService, serviceId }
