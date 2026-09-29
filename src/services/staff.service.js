/* Staff administration service — accounts, roles, and transactional emails. */
const bcrypt = require('bcryptjs')
const { StaffModel, clean } = require('../models')
const { now } = require('../utils/datetime')
const { audit } = require('./audit.service')
const { notify } = require('./notification.service')
const { getIo } = require('../sockets/socket')
const emailService = require('./email.service')

async function list() {
  const rows = await StaffModel.find()
  return rows.map(clean)
}

async function create(body, actor) {
  const id = body.role.replace(/\s+/g, '') + '-' + body.username.replace(/[^a-z]/gi, '')
  const tempPassword = body.password || 'password'
  const ADMIN_ROLES = ['Super Admin', 'Hospital Administrator']
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

module.exports = { list, create, update, changeRole }
