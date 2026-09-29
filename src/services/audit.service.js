/* Audit service — append-only governance trail. */
const { AuditModel } = require('../models')
const { now } = require('../utils/datetime')

async function audit(who, action, target, dept, extra) {
  return AuditModel.create({ who, action, target, extra, when: now(), dept })
}

module.exports = { audit }
