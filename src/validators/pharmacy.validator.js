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

module.exports = { createDrug, updateDrug, dispense }
