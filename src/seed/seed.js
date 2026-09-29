/* Seed: default staff accounts + initial settings document. */
const bcrypt = require('bcryptjs')
const { SettingModel, CounterModel } = require('../models')
const { now } = require('../utils/datetime')
const { DEFAULT_ROLE_PERMISSIONS } = require('../constants')
const {
  StaffModel, PatientModel, VisitModel, VitalModel, InvestigationModel,
  PrescriptionModel, AdmissionModel, PaymentModel, WalletTxModel, DrugModel,
  ActivityModel, AuditModel, NotificationModel,
} = require('../models')

/* Timestamp helpers producing the same format as the app's now() ("14 Sept 2026 · 10:20 am"). */
function ts(daysAgo = 0, h = 9, m = 0) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(h, m, 0, 0)
  return d.toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(',', ' ·')
}
function dayStr(daysAgo = 0) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })
}

const ROLES = {
  'Doctor': ['dr.ahmed', 'dr.chinedu', 'dr.suleiman'],
  'Records Officer': ['records_officer'],
  'Nurse': ['nurse_aisha', 'nurse_blessing'],
  'Laboratory Scientist': ['lab_sci'],
  'Pharmacist': ['pharm_chika'],
  'Accountant': ['acc_tunde'],
  'Radiologist': ['rad_sam'],
  'Super Admin': ['admin'],
  'Hospital Administrator': ['admin2'],
}

async function seed() {
  const pw = bcrypt.hashSync('password', 10)

  // Counters seeded so IDs start at recognizable numbers
  const initCounters = {
    patient: 250, visit: 425, vital: 226, investigation: 997,
    radiology: 58, prescription: 1093, admission: 46, payment: 5812,
    wallet: 1150, drug: 40, staff: 12,
  }
  for (const [k, v] of Object.entries(initCounters)) {
    await CounterModel.updateOne({ _id: k }, { seq: v }, { upsert: true })
  }

  const staff = []
  for (const [role, usernames] of Object.entries(ROLES)) {
    for (const u of usernames) {
      /* Human-readable first/surname derived from the username, e.g. dr.ahmed -> Ahmed / Suleiman. */
      const parts = u.replace(/[^a-z0-9]+/gi, ' ').trim().split(/\s+/)
      const words = parts.filter((p) => !['dr', 'nurse', 'lab', 'sci', 'pharm', 'acc', 'rad', 'officer'].includes(p.toLowerCase()))
      const cap = (w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : '')
      const firstNameFinal = cap(words[0] || parts[0] || 'User')
      const surname = cap(words[1] || 'Staff')
      const id = `${role.replace(/\s+/g, '')}-${u.replace(/[^a-z0-9]/gi, '')}`
      staff.push({
        _id: id, id, firstName: firstNameFinal, surname, phone: '08000000000',
        username: u, passwordHash: pw, role, status: 'Active',
        app: role.includes('Admin') || role === 'Super Admin' ? 'admin' : 'hospital', lastActive: now(),
      })
    }
  }
  await StaffModel.deleteMany({})
  await StaffModel.insertMany(staff)

  const s = {
    hospital: { name: 'Kebbi Clinic', address: 'Birnin Kebbi, Kebbi State', phone: '0800-KEBBI-01', email: 'info@kebbiclinic.ng' },
    investigationTypes: ['PCV', 'FBC', 'S/U/C', 'Urinalysis', 'RBS', 'Pregnancy Test', 'Urine MCS', 'Swab MCS', 'HCV', 'RVS', 'VDRL', 'FBS', 'HBsAg'],
    drugCategories: ['Analgesic', 'Antibiotic', 'Antimalarial', 'Rehydration', 'Antihypertensive', 'Antidiabetic'],
    paymentMethods: ['Wallet', 'Cash', 'Transfer', 'POS'],
    rolePermissions: DEFAULT_ROLE_PERMISSIONS,
    counters: { ...initCounters },
  }
  await SettingModel.deleteOne({})
  await SettingModel.create(s)

  await seedClinical()

  return { staffCount: staff.length, settings: true, clinical: true }
}

/* ---------- CLINICAL SEED ----------
 * Real hospital data so both apps have a complete, believable history:
 * patients → visits → consultations → vitals → investigations → prescriptions
 * → admissions → payments → wallet → activity trail → audit → notifications. */
async function seedClinical() {
  const pw = bcrypt.hashSync('password', 10)
  const R = ROLES

  /* ---- PHARMACY INVENTORY (prices drive prescribing) ---- */
  const drugs = [
    { n: 'Paracetamol 500mg', c: 'Analgesic', u: 'Tablet', s: 1200, m: 200, p: 100 },
    { n: 'Amoxicillin 500mg', c: 'Antibiotic', u: 'Capsule', s: 480, m: 100, p: 250 },
    { n: 'Artemether/Lumefantrine', c: 'Antimalarial', u: 'Tablet', s: 300, m: 60, p: 1200 },
    { n: 'ORS Sachet', c: 'Rehydration', u: 'Sachet', s: 500, m: 100, p: 150 },
    { n: 'Amlodipine 5mg', c: 'Antihypertensive', u: 'Tablet', s: 260, m: 60, p: 300 },
    { n: 'Metformin 500mg', c: 'Antidiabetic', u: 'Tablet', s: 340, m: 80, p: 200 },
    { n: 'Ibuprofen 400mg', c: 'Analgesic', u: 'Tablet', s: 700, m: 150, p: 150 },
    { n: 'Ceftriaxone 1g', c: 'Antibiotic', u: 'Injection', s: 90, m: 40, p: 2500 },
    { n: 'Diclofenac 50mg', c: 'Analgesic', u: 'Tablet', s: 400, m: 100, p: 200 },
    { n: 'Hydralazine 25mg', c: 'Antihypertensive', u: 'Tablet', s: 150, m: 40, p: 450 },
  ]
  await DrugModel.deleteMany({})
  const drugDocs = drugs.map((d, i) => ({
    _id: `DRG-0000${31 + i}`, id: `DRG-0000${31 + i}`, name: d.n, category: d.c, unit: d.u,
    stock: d.s, minStock: d.m, price: d.p, expiry: '2027-12-31',
  }))
  await DrugModel.insertMany(drugDocs)
  const D = (name) => drugDocs.find((x) => x.name === name)

  /* ---- PATIENTS (permanent record, unique ID) ---- */
  await PatientModel.deleteMany({})
  const patients = [
    { id: 'KBC-000245', fn: 'Amina', sn: 'Bello', g: 'Female', dob: '1992-04-12', ph: '08031234567', ad: '12 Emir Palace Road, Birnin Kebbi', kin: ['Hassan Bello', 'Spouse', '08031234599'], st: 'Active', w: 16500, bg: 'O+', reg: 34 },
    { id: 'KBC-000246', fn: 'Musa', sn: 'Ibrahim', g: 'Male', dob: '1985-11-03', ph: '08062345678', ad: 'Gesse Phase II, Birnin Kebbi', kin: ['Halima Ibrahim', 'Sibling', '08062345600'], st: 'Active', w: 3200, bg: 'A+', reg: 21 },
    { id: 'KBC-000247', fn: 'Grace', sn: 'Okonkwo', g: 'Female', dob: '1998-07-21', ph: '08123456789', ad: 'Nassarawa Area, Birnin Kebbi', kin: ['Peter Okonkwo', 'Parent', '08123456700'], st: 'Inactive', w: 0, bg: 'B+', reg: 14 },
    { id: 'KBC-000248', fn: 'Sani', sn: 'Aliyu', g: 'Male', dob: '1976-02-09', ph: '08034567890', ad: 'Kalgo Road, Birnin Kebbi', kin: ['Zainab Aliyu', 'Spouse', '08034567000'], st: 'Active', w: 7800, bg: 'AB+', reg: 9 },
    { id: 'KBC-000249', fn: 'Fatima', sn: 'Usman', g: 'Female', dob: '2001-09-30', ph: '08098765432', ad: 'Dakingari, Kebbi State', kin: ['Aisha Usman', 'Sibling', '08098765400'], st: 'Inactive', w: 500, bg: 'O-', reg: 5 },
    { id: 'KBC-000250', fn: 'Chinedu', sn: 'Nwosu', g: 'Male', dob: '1968-06-15', ph: '08055512345', ad: 'Unguwar Jeji, Birnin Kebbi', kin: ['Ngozi Nwosu', 'Spouse', '08055512000'], st: 'Active', w: 25000, bg: 'B-', reg: 2 },
  ]
  await PatientModel.insertMany(patients.map((p) => ({
    _id: p.id, id: p.id, firstName: p.fn, surname: p.sn, otherName: '', dob: p.dob, gender: p.g,
    phone: p.ph, address: p.ad,
    nextOfKin: { name: p.kin[0], relationship: p.kin[1], phone: p.kin[2], address: p.ad },
    status: p.st, registered: ts(p.reg, 8, 30), registeredAt: ts(p.reg, 8, 30), wallet: p.w, bloodGroup: p.bg,
  })))
  const P = (id) => patients.find((x) => x.id === id)
  const pname = (id) => { const p = P(id); return `${p.fn} ${p.sn}` }

  /* ---- VISITS (a returning patient gets a NEW VISIT, never a new record) ---- */
  await VisitModel.deleteMany({})
  const docName = 'Dr. Ahmed Suleiman'
  const visits = [
    { id: 'VIS-000420', pid: 'KBC-000245', ago: 0, h: 9, m: 2, status: 'Open', type: 'Outpatient', dx: 'Uncomplicated malaria' },
    { id: 'VIS-000421', pid: 'KBC-000246', ago: 0, h: 10, m: 15, status: 'Open', type: 'Outpatient', dx: 'Acute gastroenteritis' },
    { id: 'VIS-000422', pid: 'KBC-000248', ago: 0, h: 11, m: 40, status: 'Admission', type: 'Admission', dx: 'Severe hypertension — admitted for monitoring' },
    { id: 'VIS-000423', pid: 'KBC-000247', ago: 3, h: 9, m: 45, status: 'Completed', type: 'Outpatient', dx: 'Upper respiratory tract infection' },
    { id: 'VIS-000424', pid: 'KBC-000249', ago: 6, h: 12, m: 10, status: 'Completed', type: 'Outpatient', dx: 'Urinary tract infection' },
    { id: 'VIS-000425', pid: 'KBC-000250', ago: 0, h: 8, m: 55, status: 'Admission', type: 'Admission', dx: 'Type 2 diabetes — poor glycaemic control' },
  ]
  await VisitModel.insertMany(visits.map((v) => ({
    _id: v.id, id: v.id, patientId: v.pid, date: ts(v.ago, v.h, v.m), createdAt: ts(v.ago, v.h, v.m),
    type: v.type, status: v.status, diagnosis: v.dx,
    consultation: {
      complaint: v.dx === 'Uncomplicated malaria' ? 'Fever and headache for 3 days'
        : v.dx.includes('gastroenteritis') ? 'Vomiting and watery stool for 2 days'
        : v.dx.includes('hypertension') ? 'Recurrent headache, dizziness and palpitations'
        : v.dx.includes('respiratory') ? 'Cough, catarrh and sore throat'
        : v.dx.includes('Urinary') ? 'Burning sensation on urination and lower abdominal pain'
        : 'Excessive thirst, frequent urination and fatigue',
      history: `Patient ${pname(v.pid)} presented to Kebbi Clinic and was clerked by ${docName}. No known drug allergy.`,
      exam: v.type === 'Admission' ? 'Patient conscious, alert. Significant findings on examination documented.' : 'Patient conscious and alert. Chest clear, abdomen soft and non-tender.',
      diagnosis: v.dx, doctor: docName, at: ts(v.ago, v.h + 1, v.m + 25),
    },
  })))
  const V = (pid) => visits.filter((x) => x.pid === pid).map((x) => x.id)
  const nurse1 = 'Aisha Bello'
  const nurse2 = 'Blessing Okoro'

  /* ---- VITALS (recorded by nurses, always tied to patient + visit + staff) ---- */
  await VitalModel.deleteMany({})
  const vitals = [
    { pid: 'KBC-000245', ago: 0, h: 9, m: 15, staff: nurse1, temp: '38.4', bp: '118/76', pulse: '96', resp: '20', spo2: '97', weight: '62' },
    { pid: 'KBC-000246', ago: 0, h: 10, m: 28, staff: nurse1, temp: '37.9', bp: '110/70', pulse: '102', resp: '22', spo2: '96', weight: '74' },
    { pid: 'KBC-000248', ago: 0, h: 11, m: 52, staff: nurse2, temp: '36.8', bp: '178/104', pulse: '88', resp: '18', spo2: '98', weight: '81' },
    { pid: 'KBC-000250', ago: 0, h: 9, m: 10, staff: nurse2, temp: '36.6', bp: '142/88', pulse: '84', resp: '18', spo2: '97', weight: '93' },
    { pid: 'KBC-000247', ago: 3, h: 9, m: 58, staff: nurse1, temp: '37.4', bp: '116/74', pulse: '90', resp: '19', spo2: '98', weight: '58' },
    { pid: 'KBC-000249', ago: 6, h: 12, m: 22, staff: nurse2, temp: '37.1', bp: '112/72', pulse: '86', resp: '18', spo2: '99', weight: '55' },
    { pid: 'KBC-000248', ago: 0, h: 15, m: 5, staff: nurse2, temp: '36.7', bp: '162/96', pulse: '82', resp: '17', spo2: '98', weight: '81' },
    { pid: 'KBC-000250', ago: 0, h: 15, m: 20, staff: nurse1, temp: '36.5', bp: '136/84', pulse: '80', resp: '18', spo2: '98', weight: '93' },
  ]
  await VitalModel.insertMany(vitals.map((v, i) => ({
    _id: `VIT-0002${54 + i}`, id: `VIT-0002${54 + i}`, patientId: v.pid, visitId: V(v.pid)[0],
    staff: v.staff, temp: v.temp, bp: v.bp, pulse: v.pulse, resp: v.resp, spo2: v.spo2,
    weight: v.weight, at: ts(v.ago, v.h, v.m),
  })))

  /* ---- INVESTIGATIONS (lab + radiology, some completed with reports) ---- */
  await InvestigationModel.deleteMany({})
  const invs = [
    { pid: 'KBC-000245', dept: 'Lab', test: 'Malaria Parasite (MP)', price: 1500, status: 'Completed', ago: 0, h: 9, m: 52, values: 'MP positive — trophozoites seen. Parasite density: scanty.' },
    { pid: 'KBC-000245', dept: 'Lab', test: 'PCV', price: 800, status: 'Completed', ago: 0, h: 9, m: 52, values: 'PCV = 34%' },
    { pid: 'KBC-000246', dept: 'Lab', test: 'S/U/C', price: 2500, status: 'Completed', ago: 0, h: 10, m: 55, values: 'No growth after 24 hours of incubation.' },
    { pid: 'KBC-000248', dept: 'Lab', test: 'FBC', price: 3500, status: 'Completed', ago: 0, h: 12, m: 30, values: 'WBC 7.2, Hb 14.1, Platelets 240. Within normal limits.' },
    { pid: 'KBC-000248', dept: 'Radiology', test: 'Chest X-Ray (PA)', price: 6000, status: 'Completed', ago: 0, h: 12, m: 45, values: 'Cardiothoracic ratio within normal limits. No active lung lesion.' },
    { pid: 'KBC-000250', dept: 'Lab', test: 'FBS', price: 1200, status: 'Completed', ago: 0, h: 9, m: 25, values: 'Fasting blood sugar = 11.8 mmol/L (elevated).' },
    { pid: 'KBC-000250', dept: 'Lab', test: 'HbA1c', price: 7500, status: 'Pending', ago: 0, h: 14, m: 40 },
    { pid: 'KBC-000246', dept: 'Lab', test: 'Urine MCS', price: 3000, status: 'In Progress', ago: 0, h: 13, m: 10 },
    { pid: 'KBC-000247', dept: 'Radiology', test: 'Abdominal Ultrasound', price: 8000, status: 'Pending', ago: 3, h: 10, m: 20 },
    { pid: 'KBC-000249', dept: 'Lab', test: 'Urinalysis', price: 900, status: 'Completed', ago: 6, h: 12, m: 40, values: 'Pus cells ++, Nitrites positive — suggestive of UTI.' },
  ]
  await InvestigationModel.insertMany(invs.map((x, i) => ({
    _id: `INV-000${1002 + i}`, id: `INV-000${1002 + i}`, patientId: x.pid, visitId: V(x.pid)[0],
    dept: x.dept, test: x.test, doctor: docName, createdAt: ts(x.ago, x.h, x.m), status: x.status,
    price: x.price,
    result: x.values ? { image: '', values: x.values, at: ts(x.ago, x.h, x.m + 20), by: x.dept === 'Lab' ? 'Lab Scientist Habib' : 'Radiologist Sam' } : undefined,
  })))
  const invOf = (pid, test) => `INV-000${1002 + invs.findIndex((x) => x.pid === pid && x.test === test)}`
  /* ---- PRESCRIPTIONS (prices captured from inventory at prescribing time) ---- */
  await PrescriptionModel.deleteMany({})
  const rxDefs = [
    { pid: 'KBC-000245', ago: 0, h: 10, m: 40, status: 'Pending', items: [['Artemether/Lumefantrine', 6], ['Paracetamol 500mg', 10]] },
    { pid: 'KBC-000246', ago: 0, h: 11, m: 30, status: 'Pending', items: [['ORS Sachet', 5], ['Amoxicillin 500mg', 6]] },
    { pid: 'KBC-000248', ago: 0, h: 13, m: 15, status: 'Dispensed', items: [['Amlodipine 5mg', 30], ['Hydralazine 25mg', 10]] },
    { pid: 'KBC-000250', ago: 0, h: 14, m: 5, status: 'Dispensed', items: [['Metformin 500mg', 60], ['Diclofenac 50mg', 10]] },
    { pid: 'KBC-000247', ago: 3, h: 11, m: 20, status: 'Dispensed', items: [['Paracetamol 500mg', 10], ['Ibuprofen 400mg', 6]] },
    { pid: 'KBC-000249', ago: 6, h: 13, m: 30, status: 'Dispensed', items: [['Ceftriaxone 1g', 3], ['Paracetamol 500mg', 8]] },
  ]
  await PrescriptionModel.insertMany(rxDefs.map((r, i) => ({
    _id: `RX-000${1105 + i}`, id: `RX-000${1105 + i}`, patientId: r.pid, patientName: pname(r.pid),
    doctor: docName, visitId: V(r.pid)[0], createdAt: ts(r.ago, r.h, r.m), status: r.status,
    items: r.items.map(([name, qty]) => {
      const d = D(name)
      return { drugId: d ? d.id : '', drug: name, qty, price: d ? d.price : 0 }
    }),
  })))

  /* ---- ADMISSIONS (wards + beds, doctor responsible, discharge trail) ---- */
  await AdmissionModel.deleteMany({})
  await AdmissionModel.insertMany([
    {
      _id: 'ADM-000041', id: 'ADM-000041', patientId: 'KBC-000248', patientName: pname('KBC-000248'),
      visitId: V('KBC-000248')[0], ward: 'Male Ward', bed: 'M-012', doctor: docName,
      at: ts(0, 11, 40), reason: 'Severe hypertension — admitted for monitoring', status: 'Admitted',
    },
    {
      _id: 'ADM-000042', id: 'ADM-000042', patientId: 'KBC-000250', patientName: pname('KBC-000250'),
      visitId: V('KBC-000250')[0], ward: 'Male Ward', bed: 'M-004', doctor: 'Dr. Chinedu Eze',
      at: ts(0, 8, 55), reason: 'Type 2 diabetes — poor glycaemic control', status: 'Admitted',
    },
    {
      _id: 'ADM-000043', id: 'ADM-000043', patientId: 'KBC-000249', patientName: pname('KBC-000249'),
      visitId: V('KBC-000249')[0], ward: 'Female Ward', bed: 'F-007', doctor: docName,
      at: ts(6, 12, 30), reason: 'Urinary tract infection — IV antibiotics', status: 'Discharged',
      discharge: { date: ts(4, 10, 15), diagnosis: 'Urinary tract infection, resolved', summary: 'Completed 48 hours of IV Ceftriaxone. Patient improved significantly.', notes: 'Review at outpatient clinic in 1 week. Increase oral fluid intake.', staff: nurse1 },
    },
  ])
  /* ---- PAYMENTS + WALLET (the money trail, linked to visit & staff) ---- */
  await PaymentModel.deleteMany({})
  await WalletTxModel.deleteMany({})
  const pays = [
    { pid: 'KBC-000245', amount: 3500, method: 'Wallet', service: 'Laboratory - Malaria Parasite (MP), PCV', staff: 'System', ago: 0, h: 9, m: 58 },
    { pid: 'KBC-000246', amount: 2500, method: 'Cash', service: 'Laboratory - S/U/C', staff: 'Lab Scientist Habib', ago: 0, h: 11, m: 10 },
    { pid: 'KBC-000248', amount: 9500, method: 'Wallet', service: 'Laboratory - FBC, Radiology - Chest X-Ray (PA)', staff: 'System', ago: 0, h: 12, m: 55 },
    { pid: 'KBC-000250', amount: 1200, method: 'Wallet', service: 'Laboratory - FBS', staff: 'System', ago: 0, h: 9, m: 30 },
    { pid: 'KBC-000248', amount: 9500, method: 'Wallet', service: 'Pharmacy - prescription dispensed (RX-0001107)', staff: 'Pharmacist Chika', ago: 0, h: 13, m: 30 },
    { pid: 'KBC-000250', amount: 14000, method: 'Cash', service: 'Pharmacy - prescription dispensed (RX-0001108)', staff: 'Pharmacist Chika', ago: 0, h: 14, m: 20 },
    { pid: 'KBC-000247', amount: 1900, method: 'Transfer', service: 'Pharmacy - prescription dispensed (RX-0001109)', staff: 'Pharmacist Chika', ago: 3, h: 11, m: 45 },
    { pid: 'KBC-000249', amount: 8300, method: 'Wallet', service: 'Pharmacy - prescription dispensed (RX-0001110)', staff: 'Pharmacist Chika', ago: 6, h: 14, m: 5 },
    { pid: 'KBC-000247', amount: 8000, method: 'POS', service: 'Radiology - Abdominal Ultrasound', staff: 'Radiologist Sam', ago: 3, h: 10, m: 40 },
  ]
  await PaymentModel.insertMany(pays.map((p, i) => ({
    _id: `PAY-000${5813 + i}`, id: `PAY-000${5813 + i}`, ref: `PAY-000${5813 + i}`, patientId: p.pid,
    patientName: pname(p.pid), amount: p.amount, method: p.method, service: p.service,
    staff: p.staff, at: ts(p.ago, p.h, p.m), status: 'Paid',
  })))
  await WalletTxModel.insertMany([
    { _id: 'WTX-0001151', id: 'WTX-0001151', patientId: 'KBC-000245', type: 'Credit', amount: 20000, reason: 'Wallet funding (Ref 8841)', method: 'Transfer', staff: 'Accountant Tunde', at: ts(0, 8, 45), balanceAfter: 20000 },
    { _id: 'WTX-0001152', id: 'WTX-0001152', patientId: 'KBC-000245', type: 'Debit', amount: 3500, reason: 'Laboratory - Malaria Parasite (MP), PCV', method: 'Wallet', staff: 'System', at: ts(0, 9, 58), balanceAfter: 16500 },
    { _id: 'WTX-0001153', id: 'WTX-0001153', patientId: 'KBC-000248', type: 'Credit', amount: 25000, reason: 'Wallet funding (Ref 8852)', method: 'Cash', staff: 'Accountant Tunde', at: ts(0, 11, 20), balanceAfter: 25000 },
    { _id: 'WTX-0001154', id: 'WTX-0001154', patientId: 'KBC-000248', type: 'Debit', amount: 9500, reason: 'Laboratory - FBC, Radiology - Chest X-Ray (PA)', method: 'Wallet', staff: 'System', at: ts(0, 12, 55), balanceAfter: 15500 },
    { _id: 'WTX-0001155', id: 'WTX-0001155', patientId: 'KBC-000248', type: 'Debit', amount: 9500, reason: 'Pharmacy - prescription dispensed (RX-0001107)', method: 'Wallet', staff: 'Pharmacist Chika', at: ts(0, 13, 30), balanceAfter: 7800 },
    { _id: 'WTX-0001156', id: 'WTX-0001156', patientId: 'KBC-000250', type: 'Credit', amount: 30000, reason: 'Wallet funding (Ref 8860)', method: 'Cash', staff: 'Accountant Tunde', at: ts(0, 8, 40), balanceAfter: 30000 },
    { _id: 'WTX-0001157', id: 'WTX-0001157', patientId: 'KBC-000250', type: 'Debit', amount: 1200, reason: 'Laboratory - FBS', method: 'Wallet', staff: 'System', at: ts(0, 9, 30), balanceAfter: 28800 },
    { _id: 'WTX-0001158', id: 'WTX-0001158', patientId: 'KBC-000250', type: 'Debit', amount: 7000, reason: 'Pharmacy - prescription dispensed (RX-0001108)', method: 'Wallet', staff: 'Pharmacist Chika', at: ts(0, 14, 20), balanceAfter: 21800 },
  ])
  /* ---- ACTIVITY TRAIL (WHO / WHAT / WHEN / DEPARTMENT / PATIENT / VISIT) ----
   * This is the single most important record in the system: it is what lets the
   * hospital (and the Admin App) reconstruct everything that happened to a patient. */
  await ActivityModel.deleteMany({})
  const act = (pid, ago, h, m, what, meta, dept, green) => ({
    patientId: pid, time: ts(ago, h, m), what, meta, dept, green,
  })
  const acts = [
    /* KBC-000245 — full outpatient journey today */
    act('KBC-000245', 0, 9, 2, 'Patient checked in at Records', 'Records Officer - Yusuf Garba', 'Records', false),
    act('KBC-000245', 0, 9, 15, 'Vitals recorded - T 38.4 - BP 118/76', `Nurse - ${nurse1}`, 'Nursing', true),
    act('KBC-000245', 0, 9, 40, 'Consultation completed - Uncomplicated malaria', `Doctor - ${docName}`, 'Medical', true),
    act('KBC-000245', 0, 9, 52, 'Laboratory requested - Malaria Parasite (MP), PCV', `Doctor - ${docName}`, 'Laboratory', false),
    act('KBC-000245', 0, 9, 58, 'Wallet debited N3,500 for laboratory', 'Accountant - System', 'Accounting', true),
    act('KBC-000245', 0, 10, 12, 'Laboratory result uploaded - Malaria Parasite (MP)', 'Laboratory Scientist - Habib Yusuf', 'Laboratory', true),
    act('KBC-000245', 0, 10, 40, 'Prescription created - Artemether/Lumefantrine x6, Paracetamol x10', `Doctor - ${docName}`, 'Pharmacy', false),
    act('KBC-000245', 0, 11, 5, 'Prescription RX-0001105 awaiting dispense', 'Pharmacist - Chika Obi', 'Pharmacy', false),
    /* KBC-000246 */
    act('KBC-000246', 0, 10, 15, 'Patient checked in at Records', 'Records Officer - Yusuf Garba', 'Records', false),
    act('KBC-000246', 0, 10, 28, 'Vitals recorded - T 37.9 - BP 110/70', `Nurse - ${nurse1}`, 'Nursing', true),
    act('KBC-000246', 0, 10, 50, 'Consultation completed - Acute gastroenteritis', `Doctor - ${docName}`, 'Medical', true),
    act('KBC-000246', 0, 10, 55, 'Laboratory requested - S/U/C', `Doctor - ${docName}`, 'Laboratory', false),
    act('KBC-000246', 0, 11, 10, 'Payment received N2,500 (Cash) for S/U/C', 'Lab Scientist - Habib Yusuf', 'Accounting', true),
    act('KBC-000246', 0, 13, 10, 'Laboratory test in progress - Urine MCS', 'Laboratory Scientist - Habib Yusuf', 'Laboratory', false),
    /* KBC-000248 — admitted hypertension */
    act('KBC-000248', 0, 11, 40, 'Admitted to Male Ward bed M-012', `Doctor - ${docName}`, 'Nursing', false),
    act('KBC-000248', 0, 11, 52, 'Vitals recorded - T 36.8 - BP 178/104', `Nurse - ${nurse2}`, 'Nursing', false),
    act('KBC-000248', 0, 12, 55, 'Wallet debited N9,500 for FBC + Chest X-Ray', 'Accountant - System', 'Accounting', true),
    act('KBC-000248', 0, 13, 30, 'Medication dispensed - Amlodipine x30, Hydralazine x10', 'Pharmacist - Chika Obi', 'Pharmacy', true),
    act('KBC-000248', 0, 14, 0, 'Ward round - BP recheck 162/96, continue monitoring', `Nurse - ${nurse2}`, 'Nursing', false),
    act('KBC-000248', 0, 15, 5, 'Vitals recorded - T 36.7 - BP 162/96', `Nurse - ${nurse2}`, 'Nursing', true),
    /* KBC-000250 — admitted diabetes */
    act('KBC-000250', 0, 8, 55, 'Admitted to Male Ward bed M-004', 'Doctor - Chinedu Eze', 'Nursing', false),
    act('KBC-000250', 0, 9, 10, 'Vitals recorded - T 36.6 - BP 142/88', `Nurse - ${nurse2}`, 'Nursing', true),
    act('KBC-000250', 0, 9, 30, 'Wallet debited N1,200 for FBS', 'Accountant - System', 'Accounting', true),
    act('KBC-000250', 0, 14, 20, 'Medication dispensed - Metformin x60, Diclofenac x10', 'Pharmacist - Chika Obi', 'Pharmacy', true),
    /* KBC-000247 — completed visit 3 days ago */
    act('KBC-000247', 3, 9, 45, 'Patient checked in at Records', 'Records Officer - Yusuf Garba', 'Records', false),
    act('KBC-000247', 3, 9, 58, 'Vitals recorded - T 37.4 - BP 116/74', `Nurse - ${nurse1}`, 'Nursing', true),
    act('KBC-000247', 3, 10, 20, 'Radiology requested - Abdominal Ultrasound', `Doctor - ${docName}`, 'Radiology', false),
    act('KBC-000247', 3, 10, 40, 'Payment received N8,000 (POS) for Ultrasound', 'Radiologist - Sam Danjuma', 'Accounting', true),
    act('KBC-000247', 3, 11, 20, 'Prescription created - Paracetamol x10, Ibuprofen x6', `Doctor - ${docName}`, 'Pharmacy', false),
    act('KBC-000247', 3, 11, 45, 'Medication dispensed - Paracetamol x10, Ibuprofen x6', 'Pharmacist - Chika Obi', 'Pharmacy', true),
    act('KBC-000247', 3, 12, 10, 'Visit completed - patient marked Inactive', 'Records Officer - Yusuf Garba', 'Records', false),
    /* KBC-000249 — completed visit 6 days ago */
    act('KBC-000249', 6, 12, 22, 'Vitals recorded - T 37.1 - BP 112/72', `Nurse - ${nurse2}`, 'Nursing', true),
    act('KBC-000249', 6, 12, 40, 'Laboratory result uploaded - Urinalysis (Pus cells ++)', 'Laboratory Scientist - Habib Yusuf', 'Laboratory', true),
    act('KBC-000249', 6, 13, 30, 'Prescription created - Ceftriaxone x3, Paracetamol x8', `Doctor - ${docName}`, 'Pharmacy', false),
    act('KBC-000249', 6, 14, 5, 'Medication dispensed - Ceftriaxone x3, Paracetamol x8', 'Pharmacist - Chika Obi', 'Pharmacy', true),
    act('KBC-000249', 4, 10, 15, 'Patient discharged from Female Ward F-007', `Nurse - ${nurse1}`, 'Nursing', true),
  ].filter((a) => a.what)
  await ActivityModel.insertMany(acts)

  /* ---- AUDIT TRAIL (every meaningful action, for governance) ---- */
  await AuditModel.deleteMany({})
  await AuditModel.insertMany([
    { who: 'Yusuf Garba', action: 'Registered patient', target: 'KBC-000245', dept: 'Records', when: ts(34, 8, 30) },
    { who: 'Yusuf Garba', action: 'Registered patient', target: 'KBC-000246', dept: 'Records', when: ts(21, 8, 30) },
    { who: 'Yusuf Garba', action: 'Registered patient', target: 'KBC-000247', dept: 'Records', when: ts(14, 8, 30) },
    { who: 'Yusuf Garba', action: 'Registered patient', target: 'KBC-000248', dept: 'Records', when: ts(9, 8, 30) },
    { who: 'Yusuf Garba', action: 'Registered patient', target: 'KBC-000249', dept: 'Records', when: ts(5, 8, 30) },
    { who: 'Yusuf Garba', action: 'Registered patient', target: 'KBC-000250', dept: 'Records', when: ts(2, 8, 30) },
    { who: 'Tunde Aliyu', action: 'Credited wallet', target: 'KBC-000245', dept: 'Accounting', extra: 'N20,000 (Transfer)', when: ts(0, 8, 45) },
    { who: 'Aisha Bello', action: 'Recorded vitals', target: 'KBC-000245', dept: 'Nursing', when: ts(0, 9, 15) },
    { who: 'Ahmed Suleiman', action: 'Consultation completed', target: 'KBC-000245', dept: 'Medical', extra: 'Uncomplicated malaria', when: ts(0, 9, 40) },
    { who: 'Habib Yusuf', action: 'Uploaded laboratory result', target: 'KBC-000245', dept: 'Laboratory', extra: 'Malaria Parasite (MP)', when: ts(0, 10, 12) },
    { who: 'Chika Obi', action: 'Dispensed prescription', target: 'KBC-000248', dept: 'Pharmacy', extra: 'RX-0001107 - N9,500', when: ts(0, 13, 30) },
    { who: 'Sam Danjuma', action: 'Uploaded radiology report', target: 'KBC-000248', dept: 'Radiology', extra: 'Chest X-Ray (PA)', when: ts(0, 12, 45) },
    { who: 'Aisha Bello', action: 'Discharged patient', target: 'KBC-000249', dept: 'Nursing', extra: 'ADM-000043', when: ts(4, 10, 15) },
    { who: 'Yusuf Garba', action: 'Marked patient inactive', target: 'KBC-000247', dept: 'Records', when: ts(3, 12, 10) },
  ].map((a) => ({ ...a, extra: a.extra || undefined })))

  /* ---- NOTIFICATIONS (live feed for the right department) ---- */
  await NotificationModel.deleteMany({})
  await NotificationModel.insertMany([
    { role: 'Pharmacist', text: 'New prescription RX-0001105 for Amina Bello (KBC-000245) awaiting dispense', at: ts(0, 10, 40) },
    { role: 'Pharmacist', text: 'New prescription RX-0001106 for Musa Ibrahim (KBC-000246) awaiting dispense', at: ts(0, 11, 30) },
    { role: 'Laboratory Scientist', text: 'New laboratory request HbA1c for Chinedu Nwosu (KBC-000250)', at: ts(0, 14, 40) },
    { role: 'Laboratory Scientist', text: 'New laboratory request Urine MCS for Musa Ibrahim (KBC-000246)', at: ts(0, 13, 10) },
    { role: 'Accountant', text: 'Cash payment of N14,000 recorded for Chinedu Nwosu (KBC-000250)', at: ts(0, 14, 20) },
    { role: 'Doctor', text: 'Laboratory result ready: Malaria Parasite (MP) for Amina Bello (KBC-000245)', at: ts(0, 10, 12) },
    { role: 'Doctor', text: 'Radiology report ready: Chest X-Ray (PA) for Sani Aliyu (KBC-000248)', at: ts(0, 12, 45) },
    { role: 'Nurse', text: 'Admitted: Sani Aliyu (KBC-000248) to Male Ward bed M-012', at: ts(0, 11, 40) },
    { role: 'Super Admin', text: 'Clinical data seeded — 6 patients, 6 visits, 10 investigations, 9 payments', at: ts(0, 8, 0) },
  ])
  /* END-CLINICAL */
}

module.exports = { seed, ROLES }
