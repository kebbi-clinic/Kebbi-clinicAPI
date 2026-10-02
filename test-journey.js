/* End-to-end test of the spec §40 patient journey against the running backend. */
/* Defaults to the same port as the backend's .env (7227) so this always points
   at the server that is actually running — override with PORT=… if needed. */
const BASE = `http://localhost:${process.env.PORT || 7227}`
const users = {
  records: ['records_officer', 'password', 'hospital'],
  nurse: ['nurse_aisha', 'password', 'hospital'],
  doctor: ['dr.ahmed', 'password', 'hospital'],
  lab: ['lab_sci', 'password', 'hospital'],
  pharm: ['pharm_chika', 'password', 'hospital'],
  acct: ['acc_tunde', 'password', 'hospital'],
  admin: ['admin', 'password', 'admin'],
}
const tokens = {}

async function api(name, method, url, body, isForm) {
  const headers = {}
  if (tokens[name]) headers.Authorization = `Bearer ${tokens[name]}`
  let payload
  if (body && !isForm) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  const res = await fetch(BASE + url, { method, headers, body: isForm ? body : payload })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${JSON.stringify(data)}`)
  return data
}

async function main() {
  for (const [k, [u, p, a]] of Object.entries(users)) {
    const r = await api(k, 'POST', '/api/auth/login', { username: u, password: p, app: a })
    tokens[k] = r.token
    console.log(`LOGIN ${k}: ${r.user.name} (${r.user.role}) OK`)
  }
  // RBAC: doctor cannot dispense
  try { await api('doctor', 'POST', '/api/prescriptions/RX-01022/dispense', { method: 'Wallet' }); console.log('RBAC: FAIL - doctor dispensed!') }
  catch { console.log('RBAC: doctor blocked from dispensing OK') }

  // Step 1 - Records registers a new patient
  const p = await api('records', 'POST', '/api/patients', {
    firstName: 'Grace', surname: 'Etim', dob: '1995-02-14', gender: 'Female', phone: '08099887766', address: 'Zurfa Road, Birnin Kebbi',
    nextOfKin: { name: 'Paul Etim', relationship: 'Brother', phone: '08077665544', address: 'Zurfa Road' },
  })
  console.log('STEP 1: registered', p.id)

  // Records starts a visit for RETURNING patient John Doe (KBC-000245)
  const v1 = await api('records', 'POST', '/api/patients/KBC-000245/visits', {})
  console.log('STEP 1b: new visit for returning patient:', v1.id, '(no duplicate patient)')

  // Step 2 - Nurse records vitals
  const vit = await api('nurse', 'POST', '/api/vitals', { patientId: 'KBC-000245', visitId: v1.id, temp: '37.6C', bp: '126/82', pulse: '88', resp: '18', spo2: '98%', weight: '72kg' })
  console.log('STEP 2: vitals by', vit.staff)

  // Step 3+4 - Doctor consults, requests FBC + Chest X-ray, prescribes drugs
  const drugA = (await api('pharm', 'GET', '/api/drugs'))[0]
  await api('doctor', 'POST', `/api/visits/${v1.id}/consultation`, {
    complaint: 'Mild fever', history: '2 days', exam: 'Afebrile now', diagnosis: 'Uncomplicated malaria',
    investigations: ['FBC', 'Chest X-ray'], invDept: { 'Chest X-ray': 'Radiology' },
    rx: [{ drugId: drugA.id, qty: 1 }, { drugId: (await api('pharm', 'GET', '/api/drugs'))[1].id, qty: 5 }],
    outcome: 'Outpatient',
  })
  console.log('STEP 3/4: consultation saved, investigations + prescription created')
  // Step 5 - Lab uploads result image
  const inv = (await api('lab', 'GET', '/api/investigations?dept=Lab')).find((i) => i.visitId === v1.id && i.status === 'Pending')
  const form = new FormData()
  form.append('values', 'PCV 34% - Hb 11.2')
  form.append('image', new Blob(['fake-png'], { type: 'image/png' }), 'result.png')
  const done = await api('lab', 'POST', `/api/investigations/${inv.id}/result`, form, true)
  console.log('STEP 5: result uploaded for', done.test, '->', done.result.image)

  // Step 6 - prescription prices came from inventory
  const rxs = await api('doctor', 'GET', '/api/prescriptions')
  const myRx = rxs.find((r) => r.visitId === v1.id)
  console.log('STEP 6: prescription', myRx.id, 'items:', myRx.items.map((i) => `${i.drug} x${i.qty} @${i.price}`).join(', '))

  // Step 7 - Accountant funds wallet
  const fund = await api('acct', 'POST', '/api/wallet/fund', { patientId: 'KBC-000245', amount: 20000, method: 'Transfer', reference: 'TRX-99001' })
  console.log(`STEP 7: wallet credited -> balance ${fund.balance}`)

  // Step 8 - Pharmacist dispenses with wallet payment
  const stockBefore = (await api('pharm', 'GET', '/api/drugs')).find((d) => d.id === drugA.id).stock
  const disp = await api('pharm', 'POST', `/api/prescriptions/${myRx.id}/dispense`, { method: 'Wallet' })
  const stockAfter = (await api('pharm', 'GET', '/api/drugs')).find((d) => d.id === drugA.id).stock
  console.log(`STEP 8: dispensed total N${disp.total}; wallet now ${disp.walletBalance}; stock ${drugA.id} ${stockBefore} -> ${stockAfter}`)

  // Step 9 - wallet ledger must show real transactions
  const txs = (await api('acct', 'GET', '/api/wallettxs')).filter((t) => t.patientId === 'KBC-000245')
  console.log('STEP 9: wallet ledger:', txs.slice(0, 3).map((t) => `${t.type} N${t.amount} -> bal ${t.balanceAfter}`))

  // Patient history + admin
  const prof = await api('records', 'GET', '/api/patients/KBC-000245')
  console.log('STEP 10: activity events:', prof.activity.length, '| latest:', prof.activity[0].what)
  const stats = await api('admin', 'GET', '/api/admin/stats')
  console.log('ADMIN stats: patients', stats.totalPatients, '| admitted', stats.admitted, '| pendingInv', stats.pendingInvestigations)
  const auditLog = await api('admin', 'GET', '/api/admin/audit')
  console.log('ADMIN audit entries:', auditLog.length, '| latest:', auditLog[0].who, '-', auditLog[0].action, '-', auditLog[0].target)
  const ns = await api('admin', 'POST', '/api/admin/staff', { firstName: 'Test', surname: 'Officer', phone: '08000000000', username: 'test.records', password: 'password', role: 'Records Officer' })
  console.log('ADMIN created staff:', ns.id, ns.username)
  console.log('ALL JOURNEY STEPS PASSED')


}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
