/* Authentication & RBAC middleware: JWT verification + capability checks. */
const jwt = require('jsonwebtoken')
const { config } = require('../config/env')
const { getSettings } = require('../config/db')

function signToken(user) {
  return jwt.sign(user, config.jwtSecret, { expiresIn: config.jwtExpiresIn })
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  try {
    req.user = jwt.verify(token, config.jwtSecret)
    /* Force password change: an account flagged with mustChangePassword may only
       touch /api/auth/* (e.g. the change-password endpoint) until it is cleared. */
    if (req.user.mustChangePassword && !req.originalUrl.startsWith('/api/auth/')) {
      return res.status(403).json({ error: 'You must choose a new password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' })
    }
    next()
  } catch {
    res.status(401).json({ error: 'Not authenticated' })
  }
}

/* Can the user's role perform capability `cap`? Reads the live settings cache.
 * A per-account override (JWT `caps`, set when an admin creates a scoped
 * admin account) takes precedence: if present, ONLY those capabilities pass. */
function can(role, cap, user) {
  if (user && Array.isArray(user.caps) && user.caps.length) return user.caps.includes(cap)
  if (role === 'Super Admin' || role === 'Hospital Administrator') return true
  const perms = getSettings()?.rolePermissions
  const entry = perms?.[role]
  if (entry?.cannot?.includes(cap)) return false
  return entry?.can?.includes(cap) || false
}

function requirePerm(...caps) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    if (caps.some((c) => can(req.user.role, c, req.user))) return next()
    return res.status(403).json({ error: `Role "${req.user.role}" is not permitted to perform this action` })
  }
}

/** Wrap a router so every route requires a valid JWT. */
const protectedRouter = (router) => {
  router.use(requireAuth)
  return router
}

module.exports = { signToken, requireAuth, requirePerm, can, protectedRouter }
