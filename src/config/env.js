/* Centralised, validated environment configuration.
 * Fails fast at boot when a production-critical variable is missing. */
const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') })

const nodeEnv = process.env.NODE_ENV || 'development'

/* Comma-separated list of allowed frontend origins.
   Production origins are hardcoded here so a missing/incorrect CORS_ORIGINS
   env var can never lock the deployed apps out again. The env var (when set)
   is *merged in* on top of these, never replaces them. */
const HARDCODED_ORIGINS = [
  'https://dashboard.kebbiclinic.com.ng',
  'https://www.dashboard.kebbiclinic.com.ng',
  'https://hospital.kebbiclinic.com.ng',
  'https://www.hospital.kebbiclinic.com.ng',
  'https://protector.kebbiclinic.com.ng',
  'https://www.protector.kebbiclinic.com.ng',
  'https://www.kebbiclinic.com.ng',
  'https://kebbiclinic.com.ng',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
  'http://localhost:4174',
]
const corsOrigins = [
  ...new Set([
    ...HARDCODED_ORIGINS,
    ...(process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
  ]),
]

/* Whether an Origin header is allowed to call the API.
   Explicitly listed origins always pass; additionally any subdomain of
   kebbiclinic.com.ng (dashboard, hospital, www, …) is accepted so new
   deployments don't break CORS whenever a subdomain is added or changed.
   Requests with no Origin (curl, server-to-server) are allowed. */
function isAllowedOrigin(origin) {
  if (!origin) return true
  if (corsOrigins.includes('*')) return true
  if (corsOrigins.includes(origin)) return true
  try {
    const host = new URL(origin).hostname
    if (host === 'kebbiclinic.com.ng' || host.endsWith('.kebbiclinic.com.ng')) return true
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  } catch { /* not a URL — fall through to false */ }
  return false
}

const config = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  isTest: nodeEnv === 'test',

  port: Number(process.env.PORT) || 4000,
  corsOrigins,
  isAllowedOrigin,

  /* Web Push (VAPID). Optional — when absent a key pair is generated once and
     persisted in the database, so notifications work with zero setup. */
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:it@kebbiclinic.ng',
  },

  /* When absent, the data layer falls back to an in-memory MongoDB (dev only). */
  mongoUri: process.env.MONGODB_URI || '',
  /* Optional. On Vercel each request can land on a different instance, so
   * Socket.IO fan-out and presence need Redis to be shared. Unset locally. */
  redisUrl: process.env.REDIS_URL || '',

  jwtSecret: process.env.JWT_SECRET || 'kebbi-clinic-dev-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',

  /* Cloudflare R2 (result-file storage). Optional — local disk fallback in dev.
   * The S3 keys upload; publicBaseUrl (e.g. https://pub-xxxx.r2.dev) serves reads. */
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucket: process.env.R2_BUCKET || '',
    publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  },

  /* Mailtrap (transactional email). Optional — logged to console when unset.
   * Preferred: MAIL_API_TOKEN (Email Sending API — only a token is needed).
   * Fallback:  MAIL_USER/MAIL_PASS SMTP credentials via Nodemailer. */
  mail: {
    apiToken: process.env.MAIL_API_TOKEN || '',
    host: process.env.MAIL_HOST || 'live.smtp.mailtrap.io',
    port: Number(process.env.MAIL_PORT) || 587,
    user: process.env.MAIL_USER || '',
    pass: process.env.MAIL_PASS || '',
    from: process.env.MAIL_FROM || 'Kebbi Clinic <no-reply@kebbiclinic.ng>',
  },
}

function assertProdEnv() {
  if (!config.isProd) return
  const problems = []
  if (!config.mongoUri) problems.push('MONGODB_URI')
  if (config.jwtSecret === 'kebbi-clinic-dev-secret-change-in-production') problems.push('JWT_SECRET')
  if (problems.length) {
    throw new Error(`Refusing to start in production — set: ${problems.join(', ')}`)
  }
}

module.exports = { config, assertProdEnv }
