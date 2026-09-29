/* Authentication service — credential verification and token issuance. */
const bcrypt = require('bcryptjs')
const { StaffModel } = require('../models')
const { signToken } = require('../middleware/auth.middleware')
const { getIo } = require('../sockets/socket')
const { audit } = require('./audit.service')
const { now } = require('../utils/datetime')

/* Roles that belong in the admin console rather than the hospital app. */
const ADMIN_ROLES = ['Super Admin', 'Hospital Administrator']
const isAdminRole = (role) => ADMIN_ROLES.includes(role)

/** Per-account capability override: keep only known caps; empty = role defaults. */
function sanitiseCaps(caps) {
  if (!Array.isArray(caps)) return undefined
  const kept = caps.filter((c) => require('../constants').CAPS[c])
  return kept.length ? kept : []
}

async function login({ username, password, app }) {
  const staff = await StaffModel.findOne({ username })
  if (!staff || !(await bcrypt.compare(password, staff.passwordHash))) {
    const err = new Error('Invalid credentials')
    err.status = 401
    throw err
  }
  /* App separation: admin-console accounts may only sign in to the admin app,
     clinical staff may only sign in to the hospital app. */
  if (app === 'admin' && !isAdminRole(staff.role)) {
    const err = new Error('This account is not an administrator — please use the hospital staff app.')
    err.status = 403
    throw err
  }
  if (app === 'hospital' && isAdminRole(staff.role)) {
    const err = new Error('Administrator accounts must use the admin console.')
    err.status = 403
    throw err
  }
  if (staff.status && staff.status !== 'Active') {
    const err = new Error('This account is deactivated. Contact an administrator.')
    err.status = 403
    throw err
  }
  const caps = sanitiseCaps(staff.caps)
  const user = { id: staff.id, name: `${staff.firstName} ${staff.surname}`, role: staff.role, app: staff.app, mustChangePassword: !!staff.mustChangePassword, ...(caps && caps.length ? { caps } : {}) }
  const token = signToken(user)
  const io = getIo()
  if (io) io.to(user.role).emit('auth.userOnline', user)
  return { token, user }
}

/** Self-service password change — used on first login when an admin requires it,
 *  and any time afterwards. Clears the mustChangePassword flag and re-issues the token. */
async function changePassword({ userId, currentPassword, newPassword }) {
  const staff = await StaffModel.findById(userId) || await StaffModel.findOne({ id: userId })
  if (!staff) {
    const err = new Error('Staff account not found'); err.status = 404; throw err
  }
  if (!(await bcrypt.compare(currentPassword, staff.passwordHash))) {
    const err = new Error('Current password is incorrect')
    err.status = 401
    throw err
  }
  staff.passwordHash = bcrypt.hashSync(newPassword, 10)
  staff.mustChangePassword = false
  staff.lastActive = now()
  await staff.save()
  const caps = sanitiseCaps(staff.caps)
  const user = { id: staff.id, name: `${staff.firstName} ${staff.surname}`, role: staff.role, app: staff.app, mustChangePassword: false, ...(caps && caps.length ? { caps } : {}) }
  await audit(user.name, 'Changed own password', staff.id, 'Administration')
  return { token: signToken(user), user }
}

module.exports = { login, changePassword }
