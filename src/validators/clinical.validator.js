/* Validation schemas — clinical flows: consultation, vitals, discharge, results. */
const { body, param } = require('express-validator')
const { RX_ROUTES, RX_FREQUENCIES } = require('../constants')

/* The Consultation screen historically sent 'Admission' while the API only
   accepted 'Admit' — every consultation save was rejected with a 422 and no
   notes, labs, prescription or admission was ever written. Both spellings are
   accepted from now on. */
const ADMIT_OUTCOMES = ['Outpatient', 'Admit', 'Admission']
const isAdmit = (v) => v === 'Admit' || v === 'Admission'

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
  /* Route of administration: IV, IM, Oral or Rectal. */
  body('items.*.route').optional({ values: 'falsy' }).isIn(RX_ROUTES)
    .withMessage(`Route must be one of: ${RX_ROUTES.join(', ')}`),
  /* Frequency: Daily, BD, TDS, noctal, PRN, 4hrly … 24hrly. */
  body('items.*.frequency').optional({ values: 'falsy' }).isIn(RX_FREQUENCIES)
    .withMessage(`Frequency must be one of: ${RX_FREQUENCIES.join(', ')}`),
  /* Duration of the course, in whole days. */
  body('items.*.duration').optional({ values: 'falsy' }).isInt({ min: 1, max: 365 })
    .withMessage('Prescription duration must be between 1 and 365 days'),
  body('outcome').optional().isIn(ADMIT_OUTCOMES)
    .withMessage(`Outcome must be one of: ${ADMIT_OUTCOMES.join(', ')}`),
  /* Bed allocation. The screens post these flat; the `admission.*` shape is
     kept for compatibility. */
  body('ward').optional({ values: 'falsy' }).isString().isLength({ max: 60 }),
  body('bed').optional({ values: 'falsy' }).isString().isLength({ max: 30 }),
  body('admission.ward').optional({ values: 'falsy' }).isString(),
  body('admission.bed').optional({ values: 'falsy' }).isString(),
  body('admission.reason').optional({ values: 'falsy' }).isString().isLength({ max: 500 }),
  /* Number of nights admitted and the charge per night. */
  body('days').optional({ values: 'falsy' }).isInt({ min: 1, max: 365 })
    .withMessage('Number of days must be between 1 and 365'),
  body('costPerNight').optional({ values: 'null' }).isFloat({ min: 0 })
    .withMessage('Cost per night must be zero or more'),
  body('admission.days').optional({ values: 'falsy' }).isInt({ min: 1, max: 365 }),
  body('admission.costPerNight').optional({ values: 'null' }).isFloat({ min: 0 }),
  /* A bed charge only makes sense when the patient is actually being admitted. */
  body().custom((v) => {
    const hasDays = v.days !== undefined || v.admission?.days !== undefined
    if (hasDays && !isAdmit(v.outcome)) {
      throw new Error('Number of days can only be set when admitting a patient')
    }
    return true
  }),
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
