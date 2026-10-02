# Restore retries and reconciliation

Restore and OpenIntuneBaseline deployments honor Graph throttling with at most four attempts per request. Retry-After delays up to 30 seconds are honored; longer delays stop the attempt rather than retrying early. Reads can retry transient server/network failures. A rejected 401 can renew the delegated token once without opening an interactive sign-in window; a session requiring interaction asks the administrator to sign in again.

Writes with a dropped response, timeout or server error are not automatically repeated. Their method, target path, tenant, timestamp and available object ID are kept in the encrypted device store. A bounded policy name is saved to distinguish requests to the same collection. Full payloads and access tokens are not written to this journal. An identical uncertain request is blocked across restarts.

In Settings, select a tenant in Restore write history. Each read or change requires that tenant’s stored sign-in, current entitlement, renewed delegated token and live Intune management access. Records from other tenants are not returned. Open its history and check the target tenant in Intune. If the operation was applied, confirm its object ID.

For a reconciled creation, a subsequent retry reads the object in the recorded tenant and checks its ID and original creation fields before reusing it. Missing, unreadable or mismatched creation fields stop replay before that creation’s follow-up writes; some policy types therefore require manual completion. This creation check supplements the administrator’s verification and cannot distinguish two objects with identical creation fields.

Other reconciled writes rely on the administrator’s confirmation and reuse the recorded result without a read-back check.

Use **Correct applied ID** to amend a mistaken reconciliation without enabling another create. If the operation was not applied, confirm that explicitly to allow another attempt. Do not clear an uncertain result merely because its response was lost. For a genuinely new operation with the same request, choose **Allow a new operation** on the reconciled record and confirm that the write should be sent again. Do not clear it while resuming a repair.

Settings exposes every journal record for the selected tenant. The journal is limited to 1,000 records; completed records and reconciliations older than the one-hour repair window may be pruned under capacity pressure. Uncertain writes are never evicted, and recent reconciliations remain protected.

A created object whose required follow-up failed is an incomplete restore, not a success. Repair can resume rejected steps against the known ID during its repair window. Uncertain steps first require reconciliation. Saved write history remains available after that window, but does not recreate an expired repair authorization.

Endpoint-security `createInstance` reconciliation also verifies the template ID and reads the intent settings collection, including all pages, before comparing `settingsDelta`. Missing or mismatched settings block follow-up writes. Fields unavailable from a read are never assumed to match; complete unsupported cases manually in Intune.
