# Lokka verification: roadmap feature Graph calls

Date: 2026-09-30
Tenant: Ugur Koc Lab (lab tenant, app-only Lokka connection)
Graph version: beta (every path in this code is relative to the beta endpoint)
Scope: change-set engine, promotion, baseline upgrades, golden standards, custom baselines, hygiene, scores, health review, NCSC comparison. The OpenIntuneBaseline section was verified separately.

## Method

Record and replay. A throwaway vitest harness (deleted afterwards) answered every Graph request our code made from a tape recorded with Lokka. When an answer was missing, the harness stopped and printed the exact request our code built, including its body. That request was sent unchanged through Lokka, the real response was added to the tape and the run continued. Bodies were never written by hand.

The source was an existing three setting Windows Settings Catalog policy. It went through the promotion resolver, the custom baseline builder, the standard builder and a two-way baseline upgrade merge. The resulting bodies (name prefix "TenuVault E2E ") ran through the real engine functions: createChangeSet, previewChangeSet, approveChangeSet, applyChangeSet, previewRollback and createRollbackChangeSet. Only the app's backup route was faked, because it does not call Graph.

## Results per call

| Code path | Method and path | Result |
| --- | --- | --- |
| readCurrent / readLive (source, capture, observe, read-back) | GET deviceManagement/configurationPolicies/{id}?$expand=settings, then GET .../{id}/assignments | Settings pass. The expanded assignments were always empty; see "Settings Catalog assignments in single reads". `settings@odata.context` is ignored by the comparison |
| readCurrent on a missing or deleted policy | same GET | Pass. Graph answers 400 ResourceNotFound (not 404); read as "missing" |
| sameNameIds, deployVersion, compareWithTenant, create fingerprint | GET deviceManagement/configurationPolicies?$select=id,name | Pass. Pages of 25 with an absolute beta `@odata.nextLink`; listAll follows it |
| promotion `policies` action | GET deviceManagement/configurationPolicies?$select=id,name,platforms,technologies,lastModifiedDateTime | Pass |
| promotion names, mappableObjects, targetStateHash | GET deviceManagement/roleScopeTags?$select=id,displayName | Pass |
| same | GET deviceManagement/assignmentFilters?$select=id,displayName,platform,rule,lastModifiedDateTime | Pass |
| same | GET deviceManagement/reusablePolicySettings?$select=id,displayName,settingDefinitionId,lastModifiedDateTime,version | Pass. Duplicate display names exist in the lab; no name suggestion is made unless exactly one matches |
| standards plan | GET deviceManagement/reusablePolicySettings?$select=id,displayName | Pass |
| not-found answers of reference objects | GET assignmentFilters/{id}, roleScopeTags/{id} | 404 ResourceNotFound |
| same | GET reusablePolicySettings/{id} | 400 ResourceNotFound (like configurationPolicies). The code reads reusable settings through the list, so both forms are safe |
| promotion groupState | GET groups/{id}?$select=id,displayName | Shape pass (200 with id and displayName; 404 Request_ResourceNotFound when missing). The app has no Group.Read.All, so its 403 path could not be reproduced with Lokka; it is reported as unknown by design |
| hygiene resolveGroups | GET groups/{id}?$select=id | Shape pass, same limitation |
| writeOperation create | POST deviceManagement/configurationPolicies | Pass for the promotion, custom baseline and standard bodies. Response 201 with the new id; no `settings` in the response, so read-back is required and done |
| readBack after create | detail GET | Pass. All three verified as "match"; assignments empty |
| target fingerprint | detail GET twice | Pass. Two unchanged reads give the same fingerprint; after the update it differs |
| writeOperation update (baseline upgrade merge) | PUT deviceManagement/configurationPolicies/{id} | Pass. 204 without body; read-back "match"; assignments untouched |
| rollback of the update | PUT with the captured pre-change state | Pass. Read-back "match" |
| writeOperation delete | DELETE deviceManagement/configurationPolicies/{id} | Pass. 204; read-back 400 ResourceNotFound treated as "match" |
| repeated delete of a policy already gone | DELETE same path | Fixed. Graph answers 400 ResourceNotFound, not 404 |
| assign | POST .../{id}/assign | Not sent. No workflow sets assignments by default; no /assign request was made and assignments stayed empty |
| NCSC comparison | GitHub raw files at the pinned commit (no Graph); landscape reads GET configurationPolicies, .../{id}/settings, .../{id}/assignments | Pass. The nine pack files downloaded and matched their pinned hashes; the comparison ran against a recorded live ASR policy. The landscape reads are unchanged code; their shapes (value arrays, `@odata.count`) were confirmed |
| scores, health review | none | No Graph calls. They use the app's own routes and customer webhooks only |
| backup before apply | app routes /api/backup/* | No direct Graph calls in this code |

## Secrets and masked values

- A Settings Catalog secret reads back as `deviceManagementConfigurationSecretSettingValue` with a token in `value` and `valueState: "encryptedValueToken"`. The token was the same across reads.
- sanitizeSnapshot replaces it with the redaction marker. Promotion blocks the policy, the custom baseline marks the setting as not portable, the standard builder refuses it and the upgrade merge reports it as unsupported.
- No request sent during the run carried "****", `encryptedValueToken` or the redaction marker.
- Fixed: the engine itself only refused its own redaction marker. A caller passing an unsanitized live snapshot would have written the encrypted token back. The engine now refuses any secret setting value or "****" mask when a change set is created.

## Reference values

A lab policy that referenced a reusable setting (created for this run) reads back as `deviceManagementConfigurationReferenceSettingValue`, with `value` holding the reusable setting ID and `note: null`. This matches extractReferences and translate:

- Within one tenant, the reference is kept.
- Across tenants without a mapping, the policy is blocked and no source ID reaches the body.
- A confirmed mapping replaces the ID.
- A mapping to an ID that does not exist in the destination is rejected.

## Lab observations checked

- Encrypted OMA-URI values masked "****": not reachable here. Change sets only support Settings Catalog policies, and the new engine guard refuses "****" in any case.
- Exclusion targets stored as includes on two types: those types are not Settings Catalog. Promotion only writes Settings Catalog policies, and translate blocks or drops such exclusions explicitly. No assignment was written.
- Default enrollment configurations share display names: not touched by these features.

## Fixes

1. `src/main/features/change-sets/graph.ts`: a DELETE answered with 400 ResourceNotFound now counts as already gone, like 404. The read-back confirms it, instead of the object being reported as "rejected". The not-found check is shared with getOne.
2. `src/main/features/change-sets/model.ts` and `engine.ts`: `containsSecret` stops createChangeSet from freezing content that holds a Settings Catalog secret value or a "****" mask, whichever workflow built it.
3. `test/feature-change-sets.test.ts`: tests with small redacted recorded fixtures for both fixes. Both tests failed before the fix and pass after it.

## Settings Catalog assignments in single reads

Checked 2026-09-30 in the same lab tenant, GET only.

- `GET deviceManagement/configurationPolicies/{id}?$expand=settings,assignments` answers `"assignments": []` for policies that have assignments, with or without `settings` in the expand and with or without `$select`. `GET .../{id}/assignments` and the list `GET deviceManagement/configurationPolicies?$expand=assignments` both return them. Every read built on readObject (backups, restore live reads, drift, change-set capture and read-back, promotion sources) lost Settings Catalog assignments.
- Fix: ConfigurationPolicies expands `settings` only and reads assignments through an `extras` entry on `{id}/assignments`, paged with graph.list. The snapshot keeps the same `assignments` property and entry shape (`id`, `source`, `sourceId`, `target`), so restore (`assign.key`), comparableSnapshot and drift keep working. ComplianceSettingsPolicies (`deviceManagement/compliancePolicies`) moved the same way: the lab has no assigned sample, but `{id}/assignments` answers 200 there and the type shares the Settings Catalog service.
- Settings expansion is unaffected: a policy with 306 settings returned all 306 inline, without `settings@odata.nextLink`. readObject still follows one if Graph sends it.
- `{id}/assignments` did not page in the lab (no `@odata.nextLink`); graph.list follows one if present.
- The other registry types that expand assignments matched `{id}/assignments` wherever the lab had an assigned sample: device configurations, compliance policies (with the nested `scheduledActionsForRule` expand), PowerShell scripts, shell scripts, custom attribute scripts, remediations, feature update profiles, apps, Windows app protection, enrollment configurations and Autopilot profiles. Types without an assigned sample: administrative templates, hardware configurations, compliance scripts, quality and driver update profiles and policies, app configuration, managed app configurations, iOS and Android app protection, policy sets, Apple enrollment profiles and branding.
- Do not move shell scripts or custom attribute scripts to `{id}/assignments`: Graph answers 400 "No OData route exists" there. Their `$expand=assignments` works.
- Compatibility: snapshots from released versions keep `assignments: []` with the expand's `assignments@odata.context`; new reads have no such annotation. `assignmentsUnread` recognises them. Backup comparison uses `hashWithEmptyAssignments` (recorded for these types) against backups without it, drift and backup changes leave assignments out of the field comparison, and replace in place with assignments keeps the live assignments with a warning instead of sending an empty list. `compareObjects` now ignores every `@odata.context` annotation, like comparableSnapshot.
- Tests: `test/settings-catalog-assignments.test.ts` replays a redacted recorded pair (single GET with empty expanded assignments, `{id}/assignments` with the real one). The read test fails on the old registry entry and passes with the fix.

## Not verifiable with Lokka

- The 401 and 403 answers of the app's own delegated token (for example groups without Group.Read.All), because Lokka holds those permissions.
- The journaled write caller and its retry and throttling behavior. They are covered by unit tests; Lokka does its own HTTP.

## Cleanup

Five lab objects were created with the "TenuVault E2E " prefix: three by the engine run and two as sources for the secret and reference checks. All five were deleted, and a filtered listing confirmed that none remain. The remaining "TenuVault E2E" objects in the lab belong to the parallel OpenIntuneBaseline verification and were not touched.
