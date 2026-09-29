/* Email service — Mailtrap (transactional email).
 * Preferred transport: the Email Sending API (POST send.api.mailtrap.io) which
 * needs only MAIL_API_TOKEN. Fallback transport: SMTP via Nodemailer
 * (MAIL_USER/MAIL_PASS). If neither is configured, emails are logged to the
 * console instead (so local development never fails because of email).
 * Templates: staff welcome, password reset, low-stock alert, lab result ready. */
const nodemailer = require('nodemailer')
const { config } = require('../config/env')

const useApi = Boolean(config.mail.apiToken)
const enabled = useApi || Boolean(config.mail.user && config.mail.pass)

const transporter = !useApi && config.mail.user && config.mail.pass
  ? nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      auth: { user: config.mail.user, pass: config.mail.pass },
    })
  : null

/* Plain-text + branded HTML wrapper so every email looks consistent. */
function wrap(title, bodyHtml) {
  return `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;background:#f4f7f9;margin:0;padding:24px">
  <div style="max-width:560px;margin:auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e3eaf0">
    <div style="background:#0b5394;color:#fff;padding:18px 28px"><h2 style="margin:0;font-size:18px">Kebbi Clinic</h2></div>
    <div style="padding:28px;color:#24313d"><h3 style="margin:0 0 12px;font-size:17px">${title}</h3>${bodyHtml}<p style="margin-top:28px;font-size:12px;color:#7c8b98">Kebbi Clinic · Birnin Kebbi, Kebbi State · 0800-KEBBI-01</p></div>
  </div></body></html>`
}

async function sendEmail({ to, subject, title, bodyHtml, text }) {
  if (!to) return { sent: false, reason: 'no recipient' }
  const html = wrap(title || subject, bodyHtml)

  /* Preferred: Mailtrap Email Sending API — needs only MAIL_API_TOKEN. */
  if (useApi) {
    try {
      const res = await fetch('https://send.api.mailtrap.io/api/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.mail.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: config.mail.from, to, subject, text, html }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const reason = (Array.isArray(data.errors) && data.errors.length && data.errors.join('; ')) ||
          data.message || `HTTP ${res.status}`
        console.error('[email] failed:', reason)
        return { sent: false, reason }
      }
      return { sent: true, id: Array.isArray(data.message_ids) ? data.message_ids[0] : undefined }
    } catch (err) {
      /* Email must never break a business flow — log and continue. */
      console.error('[email] failed:', err.message)
      return { sent: false, reason: err.message }
    }
  }

  if (!enabled || !transporter) {
    console.log(`[email:dev] to=${to} subject="${subject}"`)
    return { sent: false, reason: 'mailtrap not configured (dev fallback logged)' }
  }
  try {
    const info = await transporter.sendMail({
      from: config.mail.from, to, subject,
      text: text || undefined,
      html,
    })
    return { sent: true, id: info.messageId }
  } catch (err) {
    /* Email must never break a business flow — log and continue. */
    console.error('[email] failed:', err.message)
    return { sent: false, reason: err.message }
  }
}

/* ---- Domain templates ---- */

async function sendStaffWelcome({ to, name, username, role, tempPassword, mustChange }) {
  const changeNote = mustChange
    ? '<p><b>For security you must choose a new password of your own the first time you sign in.</b></p>'
    : '<p>Please sign in and change your password immediately.</p>'
  const bodyHtml = `<p>Dear ${name},</p><p>Your <b>${role}</b> account for the Kebbi Clinic Hospital Management System has been created.</p>
    <p><b>Username:</b> ${username}<br/><b>Temporary password:</b> ${tempPassword}</p>
    ${changeNote}`
  return sendEmail({ to, subject: 'Your Kebbi Clinic staff account', title: 'Welcome to Kebbi Clinic', bodyHtml })
}

async function sendPasswordReset({ to, name, username, tempPassword, mustChange }) {
  const changeNote = mustChange
    ? '<p><b>For security you must choose a new password of your own the next time you sign in.</b></p>'
    : ''
  const bodyHtml = `<p>Dear ${name},</p><p>The password for your account <b>${username}</b> has been reset by an administrator.</p>
    <p><b>New temporary password:</b> ${tempPassword}</p>${changeNote}<p>If you did not request this, contact the administrator immediately.</p>`
  return sendEmail({ to, subject: 'Kebbi Clinic — password reset', title: 'Password reset', bodyHtml })
}

async function sendResultReady({ to, patientName, test, values }) {
  const bodyHtml = `<p>The investigation <b>${test}</b> for <b>${patientName}</b> has a completed result.</p>
    ${values ? `<p>Values: ${values}</p>` : ''}<p>Open the patient profile to review and continue care.</p>`
  return sendEmail({ to, subject: `Result ready — ${test} (${patientName})`, title: 'Investigation result ready', bodyHtml })
}

async function sendLowStockAlert({ to, drugName, stock, minStock }) {
  const bodyHtml = `<p>Pharmacy inventory alert: <b>${drugName}</b> is running low.</p>
    <p>Remaining stock: <b>${stock}</b> (minimum threshold ${minStock}). Please restock.</p>`
  return sendEmail({ to, subject: `Low stock — ${drugName}`, title: 'Pharmacy low-stock alert', bodyHtml })
}

module.exports = {
  sendEmail, sendStaffWelcome, sendPasswordReset, sendResultReady, sendLowStockAlert,
  mailtrapEnabled: enabled,
}
