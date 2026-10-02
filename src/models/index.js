/* Model registry — single import point for every Mongoose model. */
const StaffModel = require('./staff.model')
const PatientModel = require('./patient.model')
const VisitModel = require('./visit.model')
const VitalModel = require('./vital.model')
const InvestigationModel = require('./investigation.model')
const PrescriptionModel = require('./prescription.model')
const AdmissionModel = require('./admission.model')
const PaymentModel = require('./payment.model')
const WalletTxModel = require('./wallet-tx.model')
const DrugModel = require('./drug.model')
const ServiceModel = require('./service.model')
const ActivityModel = require('./activity.model')
const AuditModel = require('./audit.model')
const NotificationModel = require('./notification.model')
const { PushSubModel, PushKeyModel } = require('./push.model')
const { SettingModel, CounterModel } = require('./setting.model')
const { clean, cleanList } = require('../utils/clean')

module.exports = {
  StaffModel, PatientModel, VisitModel, VitalModel, InvestigationModel,
  PrescriptionModel, AdmissionModel, PaymentModel, WalletTxModel, DrugModel,
  ServiceModel,
  ActivityModel, AuditModel, NotificationModel, PushSubModel, PushKeyModel,
  SettingModel, CounterModel,
  clean, cleanList,
}
