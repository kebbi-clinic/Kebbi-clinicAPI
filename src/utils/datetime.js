/* Application-wide date/time helper. Produces the human-readable format the
 * entire UI already depends on: "14 Sept 2026 · 10:20 am". */
function now() {
  const d = new Date()
  return d.toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(',', ' ·')
}

/* Parse "14 Sept 2026 · 05:30 pm" into a real Date — including the time of day.
 * (The old date-only parse made "02:30 pm" sort before "10:20 am", so the
 * queues could not reliably put the LATEST entry on top.) */
function parseWhen(s) {
  const m = String(s || '').match(/^(\d{1,2})\s+(\w+)\s+(\d{4})(?:\s*·\s*(\d{1,2}):(\d{2})\s*(am|pm))?/i)
  if (!m) return null
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
  const mon = months[m[2].slice(0, 3)]
  if (mon === undefined) return null
  let h = m[4] !== undefined ? Number(m[4]) : 0
  const min = m[5] !== undefined ? Number(m[5]) : 0
  if (m[6]) {
    const pm = m[6].toLowerCase() === 'pm'
    if (h === 12) h = 0
    if (pm) h += 12
  }
  return new Date(Number(m[3]), mon, Number(m[1]), h, min)
}

/* Milliseconds since epoch for a stored timestamp — unparseable values sort
 * last-in (0), so one bad row can never scramble a whole queue. */
function whenMs(s) {
  const d = parseWhen(s)
  return d ? d.getTime() : 0
}

/* Newest-first comparator for rows carrying a display timestamp. Used instead
 * of Mongo's string sort on those fields ("10:20 am" > "02:30 pm" as text). */
function byNewest(field) {
  return (a, b) => whenMs(b?.[field]) - whenMs(a?.[field])
}

function sortByNewest(rows, field = 'at') {
  return [...(rows || [])].sort(byNewest(field))
}

function dayPrefix() {
  return now().split(' ·')[0]
}

module.exports = { now, parseWhen, whenMs, byNewest, sortByNewest, dayPrefix }
