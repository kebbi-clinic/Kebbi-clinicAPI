/* Application-wide date/time helper. Produces the human-readable format the
 * entire UI already depends on: "14 Sept 2026 · 10:20 am". */
function now() {
  const d = new Date()
  return d.toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(',', ' ·')
}

/* Parse "14 Sept 2026 · 05:30 pm" into a Date so revenue periods can be compared. */
function parseWhen(s) {
  const m = String(s || '').match(/^(\d{1,2})\s+(\w+)\s+(\d{4})/)
  if (!m) return null
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
  const mon = months[m[2].slice(0, 3)]
  if (mon === undefined) return null
  return new Date(Number(m[3]), mon, Number(m[1]))
}

function dayPrefix() {
  return now().split(' ·')[0]
}

module.exports = { now, parseWhen, dayPrefix }
