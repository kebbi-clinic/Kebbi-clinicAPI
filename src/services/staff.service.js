/* Staff administration service — accounts, roles, and transactional emails. */
const bcrypt = require('bcryptjs')
const { StaffModel, clean } = require('../models')
const { now } = require('../utils/datetime')
const { audit } = require('./audit.service')
const { notify } = require('./notification.service')
const { getIo } = require('../sockets/socket')
const emailService = require('./email.service')

/* Roles that live in the admin console. Hoisted to module scope so the delete
   guard-rail below can check for the last remaining administrator. */
const ADMIN_ROLES = ['Super Admin', 'Hospital Administrator']

async function list() {
  const rows = await StaffModel.find()
  return rows.map(clean)
}

async function create(body, actor) {
  const id = body.role.replace(/\s+/g, '') + '-' + body.username.replace(/[^a-z]/gi, '')
  /* Fail with a clear message instead of surfacing a raw Mongo duplicate-key
     500 when the username (or generated id) is already taken. */
  const clash = await StaffModel.findOne({ $or: [{ username: body.username }, { _id: id }] })
  if (clash) {
    const err = new Error(clash.username === body.username
      ? `The username "${body.username}" is already taken.`
      : `A staff record already exists with the id ${id}.`)
    err.status = 409
    throw err
  }
  const tempPassword = body.password || 'password'
  const isAdmin = ADMIN_ROLES.includes(body.role)
  const caps = Array.isArray(body.caps) ? body.caps.filter((c) => require('../constants').CAPS[c]) : []
  const staff = new StaffModel({
    _id: id, id, firstName: body.firstName, surname: body.surname, phone: body.phone,
    email: body.email || '', username: body.username,
    passwordHash: bcrypt.hashSync(tempPassword, 10), role: body.role,
    /* Admin roles always live in the admin console; others default to the hospital app. */
    status: body.status || 'Active', app: isAdmin ? 'admin' : (body.app || 'hospital'), lastActive: now(),
    caps: caps.length ? caps : undefined,
  })
  staff.id = staff._id
  staff.mustChangePassword = !!body.mustChangePassword
  await staff.save()
  await audit(actor.name, `Created staff${caps.length ? ` (scoped: ${caps.join(', ')})` : ''}`, body.username, 'Administration')

  /* Mailtrap welcome email with the temporary credentials. */
  emailService.sendStaffWelcome({ to: staff.email, name: `${staff.firstName} ${staff.surname}`, username: staff.username, role: staff.role, tempPassword, mustChange: staff.mustChangePassword })
  return clean(staff)
}

async function update(id, body, actor) {
  const staff = await StaffModel.findById(id)
  if (!staff) {
    const err = new Error('Staff not found'); err.status = 404; throw err
  }
  if (body.role) { staff.role = body.role; staff.lastActive = now(); await audit(actor.name, `Role changed to ${body.role}`, staff.id, 'Administration') }
  if (body.password) {
    staff.passwordHash = bcrypt.hashSync(body.password, 10)
    if (body.mustChangePassword !== undefined) staff.mustChangePassword = !!body.mustChangePassword
    await audit(actor.name, staff.mustChangePassword ? 'Password reset (change required at next login)' : 'Password reset', staff.id, 'Administration')
    /* Mailtrap password-reset email. */
    emailService.sendPasswordReset({ to: staff.email, name: `${staff.firstName} ${staff.surname}`, username: staff.username, tempPassword: body.password, mustChange: !!staff.mustChangePassword })
  }
  if (body.status) { staff.status = body.status; await audit(actor.name, `Status ${staff.status}`, staff.id, 'Administration') }
  /* Per-account capability override (scoped admin): an explicit array — even
     empty — replaces the account's caps; empty/undefined restores role defaults. */
  if (Array.isArray(body.caps)) {
    const kept = body.caps.filter((c) => require('../constants').CAPS[c])
    staff.caps = kept.length ? kept : undefined
    await audit(actor.name, kept.length ? `Account permissions set (${kept.length})` : 'Account permissions reset to role defaults', staff.id, 'Administration')
  }
  if (body.firstName) staff.firstName = body.firstName
  if (body.surname) staff.surname = body.surname
  if (body.phone) staff.phone = body.phone
  if (body.email !== undefined) staff.email = body.email
  await staff.save()
  await notify(actor.role, `Staff ${staff.firstName} ${staff.surname} (${body.role || staff.role}) updated`)
  const io = getIo()
  if (io) {
    io.to(staff.role).emit('staff.updated', clean(staff))
    if (body.role) io.to(body.role).emit('staff.created', clean(staff))
  }
  return clean(staff)
}

async function changeRole(username, role, actor) {
  const staff = await StaffModel.findOne({ username })
  if (!staff) {
    const err = new Error('Staff not found'); err.status = 404; throw err
  }
  const old = staff.role
  staff.role = role
  staff.lastActive = now()
  await staff.save()
  const io = getIo()
  if (io) {
    io.to(old).emit('staff.roleMoved', { id: staff.id, _id: staff.username, from: old, to: role, staff: clean(staff) })
    io.to(role).emit('staff.roleMoved', { id: staff.id, _id: staff.username, from: old, to: role, staff: clean(staff) })
  }
  await notify(role, `Staff member ${staff.firstName} ${staff.surname} assigned to ${role}`)
  await audit(actor.name, 'Staff role changed', staff.id, 'Administration', `${old} -> ${role}`)
  return clean(staff)
}

/**
 * Permanently delete a staff account.
 *
 * This removes the record outright (requirement: "delete staff records
 * completely") rather than deactivating it. Three guard rails protect the
 * hospital from locking itself out:
 *   · an admin cannot delete their own account,
 *   · the last remaining administrator cannot be deleted,
 *   · the audit trail keeps a permanent record of the deletion.
 */
async function remove(id, actor) {
  const staff = await StaffModel.findById(id)
  if (!staff) {
    const err = new Error('Staff not found'); err.status = 404; throw err
  }
  if (staff.id === actor.id) {
    const err = new Error('You cannot delete the account you are signed in with.')
    err.status = 400; throw err
  }
  if (ADMIN_ROLES.includes(staff.role)) {
    const remaining = await StaffModel.countDocuments({ role: { $in: ADMIN_ROLES }, status: { $ne: 'Inactive' } })
    if (remaining <= 1) {
      const err = new Error('This is the last active administrator account — create another one before deleting it.')
      err.status = 400; throw err
    }
  }

  const who = `${staff.firstName} ${staff.surname}`
  const username = staff.username
  const role = staff.role
  await StaffModel.deleteOne({ _id: id })
  /* Drop any live presence so "online" stays truthful. */
  const { getIo } = require('../sockets/socket')
  const io = getIo()
  if (io) {
    io.to(role).emit('staff.deleted', { id: staff.id, username })
    io.to('Super Admin').emit('staff.deleted', { id: staff.id, username })
    io.to('Hospital Administrator').emit('staff.deleted', { id: staff.id, username })
  }
  /* The audit row outlives the account so the deletion is never invisible. */
  await audit(actor.name, 'Deleted staff record', username, 'Administration',
    `${who} (${role}) — account permanently removed`)
  await notify('Super Admin', `${actor.name} permanently deleted the staff account ${username} (${who}, ${role}).`)
  return { id: staff.id, username, deleted: true }
}

module.exports = { list, create, update, changeRole, remove }
