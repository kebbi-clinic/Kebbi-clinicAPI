/* Storage service — Cloudflare R2 with local-disk fallback (dev). */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { uploadsDir } = require('../config/db')
const { config } = require('../config/env')

const useR2 = Boolean(config.r2.accountId && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucket)
let r2 = null
if (useR2) {
  r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey },
  })
  if (!config.r2.publicBaseUrl) {
    console.warn('[storage] R2_PUBLIC_BASE_URL is not set — uploaded files will not be publicly reachable.')
  }
}

/** Upload a buffer/file. Returns the public URL. Uses R2 when configured, else local disk. */
async function uploadResult(file, body) {
  const ext = path.extname(file.originalname || '')
  const key = `results/${crypto.randomUUID()}${ext}`

  if (useR2 && r2) {
    const cmd = new PutObjectCommand({
      Bucket: config.r2.bucket, Key: key, Body: body, ContentType: file.mimetype,
    })
    await r2.send(cmd)
    /* Public reads go through the bucket's r2.dev (or custom-domain) base URL. */
    if (config.r2.publicBaseUrl) return `${config.r2.publicBaseUrl}/${key}`
    return `https://${config.r2.bucket}.${config.r2.accountId}.r2.cloudflarestorage.com/${key}`
  }

  fs.mkdirSync(uploadsDir, { recursive: true })
  const filename = `${crypto.randomUUID()}${ext}`
  /* Serverless hosts (Vercel) have a read-only filesystem except /tmp —
   * fall back to the writable temp dir when the uploads dir can't be written. */
  let dir = uploadsDir
  try {
    fs.writeFileSync(path.join(dir, filename), body)
  } catch (err) {
    if (err.code !== 'EACCES' && err.code !== 'EROFS' && err.code !== 'EPERM') throw err
    dir = path.join(require('os').tmpdir(), 'kebbi-uploads')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, filename), body)
  }
  return `/api/uploads/${filename}`
}

module.exports = { uploadResult, useR2 }
