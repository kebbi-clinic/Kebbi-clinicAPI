/* Validator registry — import point for all express-validator schema groups. */
const patient = require('./patient.validator')
const staff = require('./staff.validator')
const clinical = require('./clinical.validator')
const pharmacy = require('./pharmacy.validator')
const finance = require('./finance.validator')
const settings = require('./settings.validator')

module.exports = { patient, staff, clinical, pharmacy, finance, settings }
