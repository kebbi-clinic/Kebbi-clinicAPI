/* Shared constants — roles, capabilities & the default role→capability matrix. */
const ROLES = ['Doctor', 'Nurse', 'Records Officer', 'Pharmacist', 'Accountant', 'Laboratory Scientist', 'Radiologist', 'Super Admin', 'Hospital Administrator']

const CAPS = {
  'patients.register': 'Register new patient',
  'visits.start': 'Start new visit (returning patient)',
  'patients.status': 'Mark patient Active / Inactive',
  /* Only the Records Officer may bring a patient back on the books. Kept
     separate from `patients.status` so the two never drift apart. */
  'patients.activate': 'Activate a patient (records)',
  /* Inactive patients are a records/finance matter — clinical staff only ever
     see patients who are currently active. */
  'patients.inactive.view': 'View inactive patients',
  'consultation': 'Perform consultation, request labs, prescribe',
  'vitals': 'Record vitals',
  'discharge': 'Discharge admitted patient',
  'services.record': 'Record a procedure / service performed',
  'lab.result': 'Upload laboratory results',
  'rad.result': 'Upload radiology reports',
  'rx.dispense': 'Dispense prescriptions',
  'inventory.manage': 'Manage pharmacy inventory & prices',
  'wallet.fund': 'Fund patient wallets / record payments',
  'staff.manage': 'Create / edit / deactivate staff',
  'staff.delete': 'Permanently delete a staff record',
  'services.manage': 'Create / edit procedures & services and their prices',
  'reports.view': 'View reports & audit trail',
  'settings.manage': 'Configure system settings',
  /* Admin-console page capabilities — when a sub-admin account is created with
     a selection of these, it may only see/do those parts of the admin app. */
  'admin.patients': 'Admin app: view patients & records',
  'admin.staff': 'Admin app: staff, roles, admin accounts & who is online',
  'admin.audit': 'Admin app: audit trail',
  'admin.reports': 'Admin app: dashboard stats & reports',
  'admin.settings': 'Admin app: hospital settings & role permissions',
}

const DEFAULT_ROLE_PERMISSIONS = {
  'Doctor': { can: ['visits.start', 'consultation', 'vitals', 'discharge', 'services.record'], cannot: [] },
  'Nurse': { can: ['vitals', 'discharge', 'services.record'], cannot: [] },
  'Records Officer': { can: ['patients.register', 'visits.start', 'patients.status', 'patients.activate', 'patients.inactive.view'], cannot: [] },
  'Pharmacist': { can: ['rx.dispense', 'inventory.manage'], cannot: [] },
  /* The accountant needs the inactive list to chase outstanding balances. */
  'Accountant': { can: ['wallet.fund', 'patients.inactive.view'], cannot: [] },
  'Laboratory Scientist': { can: ['lab.result'], cannot: [] },
  'Radiologist': { can: ['rad.result'], cannot: [] },
}

/* Roles allowed to see patients whose status is Inactive. Everything else sees
 * active patients only. Administrators bypass this entirely. */
const INACTIVE_VIEW_ROLES = ['Records Officer', 'Accountant']

/* Roles allowed to activate a patient. */
const ACTIVATE_ROLES = ['Records Officer']

/* Fixed clinical vocabulary for prescriptions — validated server-side and sent
 * to the apps so both sides always offer exactly the same options. */
const RX_ROUTES = ['IV', 'IM', 'Oral', 'Rectal']
const RX_FREQUENCIES = ['Daily', 'BD', 'TDS', 'Noctal', 'PRN', '4hrly', '6hrly', '8hrly', '12hrly', '24hrly']

module.exports = {
  ROLES, CAPS, DEFAULT_ROLE_PERMISSIONS, INACTIVE_VIEW_ROLES, ACTIVATE_ROLES,
  RX_ROUTES, RX_FREQUENCIES,
}
