/* Validation schemas — finance & activity. */
const { body, param } = require('express-validator')
const { getSettings } = require('../config/db')

const walletFund = [
  body('patientId').trim().notEmpty().withMessage('patientId is required'),
  body('amount').notEmpty().withMessage('Amount is required')
    .isFloat({ gt: 0 }).withMessage('A positive amount is required'),
  body('method').optional().custom((v) => {
    const methods = getSettings()?.paymentMethods || ['Wallet', 'Cash', 'Transfer', 'POS']
    if (!methods.includes(v)) throw new Error(`Payment method must be one of: ${methods.join(', ')}`)
    return true
  }),
  body('reference').optional({ values: 'falsy' }).isString().isLength({ max: 80 }),
]

const createActivity = [
  body('patientId').trim().notEmpty().withMessage('patientId is required'),
  body('what').trim().notEmpty().withMessage('Activity description (what) is required').isLength({ max: 300 }),
  body('dept').optional({ values: 'falsy' }).isString(),
]

const visitId = [param('id').trim().notEmpty().withMessage('Visit id is required')]

module.exports = { walletFund, createActivity, visitId }
