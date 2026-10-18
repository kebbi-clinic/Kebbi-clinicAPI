/* Wallet guard — ONE rule for every billable flow in the system:
 *
 *   The patient's wallet must cover the charge IN FULL before the transaction
 *   is allowed to happen. A short wallet REFUSES the transaction outright —
 *   nothing is written (no procedure, no dispense, no result, no admission, no
 *   partial debit and no "pending" payment) — and the error tells the member of
 *   staff, in plain words, to top up the patient's wallet first.
 *
 * The frontends detect the phrase "Top up the patient's wallet" and raise the
 * bold red alert card, so the wording here is part of the contract. */

function insufficientWalletError(patient, needed, what) {
  const balance = Number(patient.wallet) || 0
  const err = new Error(
    `INSUFFICIENT WALLET BALANCE — ${what} is ₦${Number(needed).toLocaleString('en-NG')} but `
    + `${patient.firstName} ${patient.surname}'s wallet holds only ₦${balance.toLocaleString('en-NG')}. `
    + 'Top up the patient\'s wallet before continuing.',
  )
  err.status = 402 // Payment Required
  return err
}

/** Throw when `needed` is more than the wallet holds; otherwise do nothing. */
function assertWalletCovers(patient, needed, what) {
  const balance = Number(patient.wallet) || 0
  if (Number(needed) > balance) throw insufficientWalletError(patient, needed, what)
}

module.exports = { insufficientWalletError, assertWalletCovers }