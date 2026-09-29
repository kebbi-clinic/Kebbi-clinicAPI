/* Wrap an async route handler so thrown/rejected errors reach the central
 * error middleware instead of crashing the process. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

module.exports = { asyncHandler }
