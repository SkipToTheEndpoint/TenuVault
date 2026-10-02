# 147: Scheduled health review and opt-in notifications

## What it does

Operations > Health review reviews one tenant for:

| Check | Source | Thresholds |
| --- | --- | --- |
| Stale or missing backups | `/api/list-backups` (same storage as the Backup page) | Same as the dashboard `backupHealth`: healthy below 24 hours, warning (medium) below 48 hours, critical after. No complete backup: high, or critical when recent backups failed. |

Every finding stores a deduplication key (`<check>:<subject>`), severity, state (open, unknown, resolved), first seen, last seen, evidence time, owner and acknowledgement. A review that cannot read evidence records an explicit unknown finding and leaves earlier findings of that check untouched. Findings resolve and reopen only from fresh evidence; a reopen increases the occurrence counter and clears the acknowledgement. Notification delivery never changes a finding.

Runs are stored with trigger (manual, scheduled, catch-up), missed windows, check details, counts and delivery results. The last 300 runs are kept.

### Scheduling and runtime

The scheduler checks every minute while TenuVault runs. Each tenant has its own opt-in schedule (1 to 168 hours, default 24). After a gap (app closed, computer asleep) a due tenant gets one catch-up review, then the next review is a full interval later. When the admin is not signed in, the review records "could not authenticate" and retries within the hour. Nothing runs while the app is closed or the admin is signed out; the tab shows this, the last review, the next due time and readiness (ready, off, sign-in required, not licensed).

### Notifications

Off until the admin adds an endpoint:

- Local: a system notification on this computer with counts only.
- Webhook: an admin-entered https URL (no other scheme, no credentials in the URL), optional secret header stored only in the encrypted workspace store and never returned to the renderer. Sent through `externalFetch` with redirects refused and a 10 second timeout.

The webhook body contains only: schema, test flag, generated time, review time and status, counts per severity and unknown, and per new finding its key, check, severity, state and timestamps. Tenant display name and raw IDs are included only when the admin opts in; otherwise GUIDs in keys are replaced by short stable hashes. No titles, reasons, owners, policy content, tokens or credentials. "Preview payload" shows the exact JSON.

Each finding occurrence is sent once per endpoint. Failures are retried up to 3 attempts (waits 2 and 8 seconds) for network errors, 408, 429 and 5xx; other answers stop at once. A failed delivery is shown on the endpoint and in the run, and is tried again at the next review, never turned into another notification. Endpoints can be turned off, tested and removed.

## Plan boundary

- Community: in-app backup status only. The tab shows stored results read-only (`get-status`, `list-findings`, `list-runs`) and nothing when there are none.
- Pro: scheduled organization review, findings, owners and notifications (`/api/health-review`, feature `healthReview`).
- MSP: `portfolio-status` adds customer triage across licensed connected tenants (last review, outcome, counts, owners).
- A tenant whose plan no longer includes the review is skipped by the scheduler ("not licensed"); stored findings stay readable.

## Limits

- Not independent monitoring: a closed, asleep or signed-out computer does not review or notify.
- Backup age depends on reading storage; while that fails the backup check is unknown, not healthy.
- Removing or turning off an endpoint is a paid action today (see the report on action naming); stored findings remain readable after a downgrade, and the scheduler sends nothing for unlicensed tenants.

## Manual verification

1. Pro tenant, signed in. Open Operations > Health review. Expect "Open findings: Unknown" and "No review has run yet".
2. Click Review now. Expect a completed run and a backup finding matching the Backup page age.
3. Turn on "Review on a schedule" every 6 hours. Expect readiness Ready and a next due time. Quit TenuVault for longer than one interval, reopen it and wait a minute: expect one run with trigger catch-up and the missed window count.
4. Sign out of the tenant and click Review now: expect "Could not authenticate", readiness "Sign-in required", and the earlier backup finding still open.
5. Add "Notify on this computer" with minimum severity medium; run a review with a finding: one system notification. Run again: no second notification.
6. Add a webhook to a request bin you control (https). Click Preview payload: confirm no titles, tokens or GUIDs. Turn on "Include tenant and record IDs" and preview again: tenant ID appears. Send test: the bin receives `"test": true`.
7. Point the webhook at a URL that answers 503: run a review, expect "failed after 3 attempts" on the endpoint and in the run; findings unchanged.
8. Try adding `http://` or `https://user:pw@host`: rejected.
9. Set an owner and acknowledge a finding; fix the cause (make a fresh backup) and review again: the finding is resolved. Make it stale again: it reopens as "Reopened 1x" without the acknowledgement.
10. MSP with two licensed tenants: Customer triage > Load customers lists both; a tenant never reviewed shows "Never reviewed: unknown". On Pro the button shows the MSP badge and explains the plan.
11. Switch the license to Community: the tab shows the locked preview and the stored findings read-only; the scheduler records "not licensed" and sends nothing.
