/* Multer upload middleware for result files (lab/radiology) and general uploads. */
const multer = require('multer')

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf']

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED_MIME.includes(file.mimetype)
    cb(ok ? null : new Error('Only PNG/JPG/WebP images or PDFs are allowed'), ok)
  },
})

module.exports = { upload, ALLOWED_MIME }
