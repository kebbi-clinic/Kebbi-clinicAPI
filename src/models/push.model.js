const mongoose = require('mongoose')

/* Web Push: browser subscription endpoints + the auto-generated VAPID key pair.
 * Keys are generated once and persisted so subscriptions survive server restarts. */
const PushSubSchema = new mongoose.Schema({
  endpoint: { type: String, required: true, unique: true },
  p256dh: String, auth: String,
  role: String, userId: String, app: String,
}, { collection: 'pushsubs', versionKey: false, timestamps: { createdAt: 'at', updatedAt: false } })

const PushKeySchema = new mongoose.Schema({
  _id: String, public: String, private: String,
}, { collection: 'pushkeys', versionKey: false })

module.exports = {
  PushSubModel: mongoose.model('PushSub', PushSubSchema),
  PushKeyModel: mongoose.model('PushKey', PushKeySchema),
}
