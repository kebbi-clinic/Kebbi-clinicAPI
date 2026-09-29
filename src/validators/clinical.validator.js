/* Validation schemas — clinical flows: consultation, vitals, discharge, results. */
const { body, param } = require('express-validator')

const consultation = [
  param('id').trim().notEmpty().withMessage('Visit id is required'),
  body('complaint').optional().isString().isLength({ max: 2000 }),
  body('history').optional().isString().isLength({ max: 2000 }),
  body('exam').optional().isString().isLength({ max: 2000 }),
  body('diagnosis').optional().isString().isLength({ max: 500 }),
  body('investigations').optional().isArray().withMessage('Investigations must be an array'),
  body('investigations.*.test').optional().trim().notEmpty().withMessage('Each investigation needs a test name'),
  body('items').optional().isArray().withMessage('Prescription items must be an array'),
  body('items.*.drugId').optional().trim().notEmpty().withMessage('Each prescription item needs a drugId'),
  body('items.*.qty').optional().isInt({ min: 1 }).withMessage('Prescription quantity must be at least 1'),
  body('outcome').optional().isIn(['Outpatient', 'Admit']).withMessage('Outcome must be Outpatient or Admit'),
  body('admission.ward').optional({ values: 'falsy' }).isString(),
  body('admission.bed').optional({ values: 'falsy' }).isString(),
  body('admission.reason').optional({ values: 'falsy' }).isString(),
]

const createVitals = [
  body('patientId').trim().notEmpty().withMessage('patientId is required'),
  body('visitId').trim().notEmpty().withMessage('visitId is required'),
  body('temp').optional({ values: 'falsy' }).isString().isLength({ max: 20 }),
  body('bp').optional({ values: 'falsy' }).matches(/^\d{2,3}\/\d{2,3}$/).withMessage('BP must look like 120/80'),
  body('pulse').optional({ values: 'falsy' }).isString().isLength({ max: 20 }),
  body('resp').optional({ values: 'falsy' }).isString().isLength({ max: 20 }),
  body('spo2').optional({ values: 'falsy' }).isString().isLength({ max: 20 }),
  body('weight').optional({ values: 'falsy' }).isString().isLength({ max: 20 }),
]

const discharge = [
  param('id').trim().notEmpty().withMessage('Admission id is required'),
  body('diagnosis').optional().isString().isLength({ max: 500 }),
  body('summary').optional().isString().isLength({ max: 4000 }),
  body('notes').optional().isString().isLength({ max: 4000 }),
]

const investigationId = [
  param('id').trim().notEmpty().withMessage('Investigation id is required'),
]

module.exports = { consultation, createVitals, discharge, investigationId }
