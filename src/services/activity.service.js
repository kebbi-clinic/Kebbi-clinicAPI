/* Activity service — the clinic-wide live feed of everything happening. */
const { ActivityModel, clean } = require('../models')
const { now } = require('../utils/datetime')
const { broadcastActivity } = require('../sockets/socket')

async function list({ dept, patientId, limit = 200 }) {
  const filter = {}
  if (dept) filter.dept = dept
  if (patientId) filter.patientId = patientId
  const rows = await ActivityModel.find(filter).sort({ _id: -1 }).limit(Math.min(Number(limit) || 200, 1000))
  return rows.map(clean)
}

async function byPatient(patientId) {
  const rows = await ActivityModel.find({ patientId }).sort({ _id: -1 })
  return rows.map(clean)
}

async function create(body, actor) {
  const act = await ActivityModel.create({
    patientId: body.patientId, time: now(), what: body.what,
    meta: `${actor.role} - ${actor.name}`, dept: body.dept || actor.role, green: body.green,
  })
  broadcastActivity(clean(act), undefined, actor.name)
  return { ok: true }
}

module.exports = { list, byPatient, create }
