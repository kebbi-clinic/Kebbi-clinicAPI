/* Shared constants — roles, capabilities & the default role→capability matrix. */
const ROLES = ['Doctor', 'Nurse', 'Records Officer', 'Pharmacist', 'Accountant', 'Laboratory Scientist', 'Radiologist', 'Super Admin', 'Hospital Administrator']

const CAPS = {
  'patients.register': 'Register new patient',
  'visits.start': 'Start new visit (returning patient)',
  'patients.status': 'Mark patient Active / Inactive',
  'consultation': 'Perform consultation, request labs, prescribe',
  'vitals': 'Record vitals',
  'discharge': 'Discharge admitted patient',
  'lab.result': 'Upload laboratory results',
  'rad.result': 'Upload radiology reports',
  'rx.dispense': 'Dispense prescriptions',
  'inventory.manage': 'Manage pharmacy inventory & prices',
  'wallet.fund': 'Fund patient wallets / record payments',
  'staff.manage': 'Create / edit / deactivate staff',
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
  'Doctor': { can: ['visits.start', 'consultation', 'vitals', 'discharge'], cannot: [] },
  'Nurse': { can: ['vitals', 'discharge'], cannot: [] },
  'Records Officer': { can: ['patients.register', 'visits.start', 'patients.status'], cannot: [] },
  'Pharmacist': { can: ['rx.dispense', 'inventory.manage'], cannot: [] },
  'Accountant': { can: ['wallet.fund'], cannot: [] },
  'Laboratory Scientist': { can: ['lab.result'], cannot: [] },
  'Radiologist': { can: ['rad.result'], cannot: [] },
}

module.exports = { ROLES, CAPS, DEFAULT_ROLE_PERMISSIONS }
