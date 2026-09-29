/* Web Push service — sends browser notifications to role-targeted subscribers so
 * staff hear the alert even when the tab is closed (as long as the browser runs).
 * VAPID keys come from env when set, otherwise generated once and stored in Mongo. */
const webpush = require('web-push')
const { PushSubModel, PushKeyModel } = require('../models')
const { config } = require('../config/env')

let cached = null

async function vapidKeys() {
  if (cached) return cached
  if (config.vapid.publicKey && config.vapid.privateKey) {
    cached = { publicKey: config.vapid.publicKey, privateKey: config.vapid.privateKey, subject: config.vapid.subject }
    return cached
  }
  let doc = await PushKeyModel.findById('vapid')
  if (!doc) {
    const g = webpush.generateVAPIDKeys()
    doc = await PushKeyModel.create({ _id: 'vapid', public: g.publicKey, private: g.privateKey })
    console.log('[push] generated VAPID key pair (persisted in pushkeys collection)')
  }
  cached = { publicKey: doc.public, privateKey: doc.private, subject: config.vapid.subject }
  return cached
}

/** The public VAPID key the frontend needs to subscribe. */
async function publicKey() { return (await vapidKeys()).publicKey }

/** Store/refresh a subscription for the logged-in user (role taken from the JWT, never the client). */
async function subscribe(user, sub) {
  if (!sub || !sub.endpoint || !sub.keys) {
    const err = new Error('Invalid push subscription'); err.status = 400; throw err
  }
  await PushSubModel.updateOne(
    { endpoint: sub.endpoint },
    { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, role: user.role, userId: user.id, app: user.app || 'hospital' },
    { upsert: true },
  )
}

async function unsubscribe(endpoint) {
  if (!endpoint) return
  await PushSubModel.deleteOne({ endpoint })
}

/**
 * Deliver a Web Push notification to every subscription whose role is in `roles`.
 * Fire-and-forget: push failures (expired subscriptions, offline) are swallowed,
 * expired endpoints are pruned.
 */
async function pushToRoles(roles, payload) {
  try {
    const keys = await vapidKeys()
    webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey)
    const subs = await PushSubModel.find({ role: { $in: roles } })
    const body = JSON.stringify(payload)
    await Promise.allSettled(subs.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body)
        .catch((e) => { if (e.statusCode === 404 || e.statusCode === 410) PushSubModel.deleteOne({ endpoint: s.endpoint }).catch(() => {}) }),
    ))
  } catch (e) {
    console.warn('[push] send failed:', e.message)
  }
}

module.exports = { publicKey, subscribe, unsubscribe, pushToRoles }
