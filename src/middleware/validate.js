/* express-validator runner: collects errors and returns the same { error } shape
 * the frontends already render, with a machine-readable `details` array attached. */
const { validationResult } = require('express-validator')

function validate(schemas) {
  return async (req, res, next) => {
    await Promise.all(schemas.map((s) => s.run(req)))
    const result = validationResult(req)
    if (result.isEmpty()) return next()
    const details = result.array({ onlyFirstError: true }).map((e) => ({ field: e.path, message: e.msg }))
    return res.status(422).json({ error: details[0].message, details })
  }
}

module.exports = { validate }
