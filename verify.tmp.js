const BASE = 'http://localhost:7227'
const T = {}
async function api(n, m, u, b, form) {
  const h = {}
  if (T[n]) h.Authorization = 'Bearer ' + T[n]
  let p
  if (b && !form) { h['Content-Type'] = 'application/json'; p = JSON.stringify(b) }
  const r = await fetch(BASE + u, { method: m, headers: h, body: form ? b : p })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${m} ${u} -> ${r.status} ${JSON.stringify(d)}`)
  return d
}
let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (n) => console.log(`\n== ${n} ==`)

/* Mirrors the FIXED frontend filter in Consultation.tsx / Nursing.tsx. */
const OPEN_VISIT_STATUSES = ['Open', 'Waiting', 'Active']

;(async () => {
  for (const [k, u, a] of [
    ['rec', 'records_officer', 'hospital'], ['doc', 'dr.ahmed', 'hospital'],
    ['nurse', 'nurse_aisha', 'hospital'], ['lab', 'lab_sci', 'hospital'],
    ['pharm', 'pharm_chika', 'hospital'], ['acct', 'acc_tunde', 'hospital'],
  ]) { T[k] = (await api(k, 'POST', '/api/auth/login', { username: u, password: 'password', app: a })).token }
  /* Live DB's radiologist password was changed by someone else; the radiology
     queue is auth-only, so a doctor token reads it. */
  T.rad = T.doc

  const pat = await api('rec', 'POST', '/api/patients', {
    firstName: 'Verify', surname: 'Case', dob: '1992-04-04', gender: 'Male',
    phone: '08099990001', address: 'Birnin Kebbi',
    nextOfKin: { name: 'K', relationship: 'Brother', phone: '08099990002', address: 'Birnin Kebbi' },
  })
  const pid = pat.id
  /* Activation takes the fee from the wallet, so fund BEFORE activating. */
  await api('acct', 'POST', '/api/wallet/fund', { patientId: pid, amount: 50000, method: 'Cash' })
  await api('rec', 'POST', `/api/patients/${pid}/activate`, {})
  const visit = await api('rec', 'POST', `/api/patients/${pid}/visits`, {})
  const wallet = async () => (await api('rec', 'GET', `/api/patients/${pid}`)).wallet
  const drugs = await api('pharm', 'GET', '/api/drugs')

  /* ================= 5. CONSULTATION SAVES ================= */
  section('5. Consultation saves (visit must be selectable)')
  const bundle = await api('doc', 'GET', `/api/patients/${pid}`)
  const selectable = (bundle.visits || []).filter((v) => OPEN_VISIT_STATUSES.includes(v.status) || !!v.consultation)
  ok('fresh visit selectable on Consultation', selectable.some((v) => v.id === visit.id), `status=${visit.status}`)
  ok('fresh visit selectable on Ward & Nursing', selectable.some((v) => v.id === visit.id))

  const cons = await api('doc', 'POST', `/api/visits/${visit.id}/consultation`, {
    complaint: 'Fever 3 days', history: 'No prior treatment', exam: 'Warm, alert',
    diagnosis: 'Uncomplicated malaria',
    investigations: ['FBC', 'PCV', 'Chest X-ray'], invDept: { 'Chest X-ray': 'Radiology' },
    items: [{ drugId: drugs[0].id, qty: 10, route: 'Oral', frequency: 'Daily', duration: 5 }],
    outcome: 'Outpatient', ward: 'Male Ward', bed: 'M-012',
  })
  ok('POST /visits/:id/consultation succeeds', !!cons.id, `visit=${cons.id}`)
  ok('visit closed after consultation', cons.status === 'Completed', `status=${cons.status}`)

  /* ================= 4. PRESCRIPTIONS ================= */
  section('4. Prescription saved + visible on pharmacy')
  const rxs = await api('pharm', 'GET', '/api/prescriptions')
  const myRx = rxs.find((r) => r.visitId === visit.id)
  ok('GET /api/prescriptions contains it', !!myRx, myRx ? `${myRx.id} ${myRx.status}` : 'missing')
  ok('priced from inventory', !!myRx && myRx.items.every((i) => i.price > 0), myRx ? `unit ${myRx.items[0].price}` : '')
  const pharmDash = await api('pharm', 'GET', '/api/dashboard')
  ok('Pharmacist dashboard shows it (rx)', (pharmDash.rx || []).some((r) => r.id === myRx?.id),
    `rx rows=${(pharmDash.rx || []).length} pending=${pharmDash.stats?.pending}`)

  /* ================= 6. INVESTIGATIONS ================= */
  section('6. Investigation saved + visible on laboratory')
  const labList = await api('lab', 'GET', '/api/investigations?dept=Lab')
  const myLab = labList.filter((i) => i.visitId === visit.id)
  ok('lab queue contains them', myLab.length === 2, myLab.map((i) => `${i.id} ${i.test} ₦${i.price}`).join(' | '))
  ok('test prices stamped (not ₦0)', myLab.every((i) => i.price > 0) && myLab.length === 2)
  const radList = await api('doc', 'GET', '/api/investigations?dept=Radiology')
  const myRad = radList.filter((i) => i.visitId === visit.id)
  ok('radiology request routed correctly', myRad.some((i) => i.test === 'Chest X-ray'),
    myRad.map((i) => `${i.test} ₦${i.price}`).join(' | '))
  const labDash = await api('lab', 'GET', '/api/dashboard')
  ok('Laboratory dashboard shows them (requests)', (labDash.requests || []).some((i) => i.visitId === visit.id),
    `requests=${(labDash.requests || []).length} pending=${labDash.stats?.pending}`)

  /* ================= 7. LAB DEDUCTS TEST PRICE ================= */
  section('7. Laboratory deducts the test price from the wallet')
  const target = myLab.find((i) => i.test === 'FBC') || myLab[0]
  const wBefore = await wallet()
  const fd = new FormData()
  fd.append('values', 'WBC 7.2, Hb 14.1')
  fd.append('image', new Blob(['fake-png'], { type: 'image/png' }), 'result.png')
  const res = await api('lab', 'POST', `/api/investigations/${target.id}/result`, fd, true)
  const wAfter = await wallet()
  ok('result submitted', res.status === 'Completed', `${target.id} ${target.test}`)
  ok('wallet debited by the test price', wBefore - wAfter === target.price,
    `${wBefore} -> ${wAfter} (deducted ${wBefore - wAfter}, price ${target.price})`)
  ok('response reports the money moved', res.debitedFromWallet === target.price && typeof res.walletBalance === 'number',
    `debited=${res.debitedFromWallet} outstanding=${res.outstanding} balance=${res.walletBalance}`)
  const ledger = (await api('acct', 'GET', '/api/wallettxs')).filter((t) => t.patientId === pid && t.type === 'Debit')
  ok('wallet ledger has a Debit row', ledger.some((t) => t.amount === target.price),
    ledger.slice(0, 3).map((t) => `${t.id} ₦${t.amount}`).join(' | '))
  const pays = (await api('acct', 'GET', '/api/payments')).filter((p) => p.patientId === pid)
  ok('payment record created', pays.some((p) => p.amount === target.price && p.status === 'Paid'),
    pays.map((p) => `${p.id} ₦${p.amount} ${p.status}`).join(' | '))

  const fd2 = new FormData()
  fd2.append('values', 'corrected')
  fd2.append('image', new Blob(['png2'], { type: 'image/png' }), 'r2.png')
  const wMid = await wallet()
  await api('lab', 'POST', `/api/investigations/${target.id}/result`, fd2, true)
  const wEnd = await wallet()
  ok('re-submitting a result does NOT double-charge', wMid === wEnd, `${wMid} -> ${wEnd}`)

  /* ================= 3. PROCEDURE DEDUCTS WALLET ================= */
  section('3. Submitting a procedure deducts the wallet')
  const svc = (await api('doc', 'GET', '/api/services')).filter((s) => s.active !== false)
  ok('catalogue reachable by Doctor', svc.length > 0, `${svc.length} services`)
  const svcNurse = await api('nurse', 'GET', '/api/services')
  ok('catalogue reachable by Nurse', svcNurse.length > 0, `${svcNurse.length} services`)
  const p3 = await wallet()
  const perf = await api('nurse', 'POST', '/api/services/perform', { patientId: pid, serviceId: svc[0].id, notes: 'done', settle: 'Wallet' })
  const p4 = await wallet()
  ok('POST /services/perform succeeds', !!perf.procedure, `${svc[0].name} ₦${svc[0].amount}`)
  ok('wallet debited by the amount', p3 - p4 === svc[0].amount, `${p3} -> ${p4} (deducted ${p3 - p4})`)
  const prof = await api('rec', 'GET', `/api/patients/${pid}`)
  ok('written to the patient permanent record', (prof.procedures || []).some((x) => x.name === svc[0].name),
    (prof.procedures || []).map((x) => `${x.name} ₦${x.amount}`).join(' | '))

  /* ================= 2. ROLES ================= */
  section('2. Doctors and Nurses can access procedures + inventory')
  for (const [who, label] of [['doc', 'Doctor'], ['nurse', 'Nurse'], ['acct', 'Accountant']]) {
    const inv2 = await api(who, 'GET', '/api/services/inventory')
    ok(`${label} can read GET /api/services/inventory`, Array.isArray(inv2.items), `${inv2.items.length} rows`)
  }
  const denied = await api('doc', 'POST', '/api/prescriptions/RX-999999/dispense', { method: 'Wallet' })
    .then(() => false).catch(() => true)
  ok('Doctor still blocked from dispensing (RBAC intact)', denied)

  /* ================= 1. INVENTORY: procedure / amount / quantity ================= */
  section('1. Inventory has procedure / amount / quantity')
  const inv = await api('acct', 'GET', '/api/services/inventory')
  const row = inv.items[0] || {}
  ok('row has procedure', 'procedure' in row, String(row.procedure))
  ok('row has amount', 'amount' in row, String(row.amount))
  ok('row has quantity', 'quantity' in row, String(row.quantity))
  ok('quantity counts performed procedures', inv.items.some((i) => i.quantity > 0),
    inv.items.map((i) => `${i.procedure}=₦${i.amount}x${i.quantity}`).join(' | '))
  ok('totals present', !!inv.totals && typeof inv.totals.quantity === 'number', JSON.stringify(inv.totals))
  const aDash = await api('acct', 'GET', '/api/dashboard')
  ok('Accountant dashboard carries procedureInventory', !!aDash.procedureInventory,
    aDash.procedureInventory ? `${aDash.procedureInventory.items.length} rows, qty ${aDash.procedureInventory.totals.quantity}` : 'missing')


  /* ================= REGRESSION: OTHER PAGES STILL SAVE ================= */
  section('Regression: other pages still save')
  const vit = await api('nurse', 'POST', '/api/vitals', { patientId: pid, visitId: visit.id, temp: '37.5C', bp: '120/80', pulse: '78', spo2: '98%' })
  ok('Nursing vitals save', !!vit.id, vit.id)
  const act = await api('nurse', 'POST', '/api/activity', { patientId: pid, what: 'Ward round - stable', dept: 'Nursing' })
  ok('Ward round saves', act.ok === true)
  const fund = await api('acct', 'POST', '/api/wallet/fund', { patientId: pid, amount: 5000, method: 'POS', reference: 'TRX-1' })
  ok('Wallet funding saves', typeof fund.balance === 'number', `balance ${fund.balance}`)
  const disp = await api('pharm', 'POST', `/api/prescriptions/${myRx.id}/dispense`, { method: 'Wallet' })
  ok('Pharmacy dispense saves', disp.prescription?.status === 'Dispensed', `total ₦${disp.total} wallet ${disp.walletBalance}`)
  const adm = await api('doc', 'POST', `/api/visits/${visit.id}/consultation`, {
    complaint: 'r', history: 'r', exam: 'r', diagnosis: 'review',
    investigations: ['FBC'],
    items: [{ drugId: drugs[1].id, qty: 2, route: 'Oral', frequency: 'Daily', duration: 3 }],
    outcome: 'Outpatient',
  })
  ok('Re-saving a consultation succeeds', !!adm.id)
  const rxs2 = await api('pharm', 'GET', '/api/prescriptions')
  const labs2 = (await api('lab', 'GET', '/api/investigations?dept=Lab')).filter((i) => i.visitId === visit.id)
  ok('Re-save does NOT duplicate prescriptions', rxs2.filter((r) => r.visitId === visit.id).length === 1,
    `${rxs2.filter((r) => r.visitId === visit.id).length} for this visit`)
  ok('Re-save does NOT duplicate investigations', labs2.length === 2, `${labs2.length} for this visit`)

  console.log(`\n${'='.repeat(56)}\nRESULT: ${pass} passed, ${fail} failed\n${'='.repeat(56)}`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error('\nHARNESS ERROR:', e.message); process.exit(1) })


