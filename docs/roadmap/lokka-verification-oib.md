# OpenIntuneBaseline: Microsoft Graph verification with Lokka

Date: 2026-09-30
Tenant: Ugur Koc Lab (lab tenant, app-only Lokka connection, Graph beta)
Scope: `src/main/oib/{service,source}.ts`, `src/shared/oib/*`, route `/api/oib` (actions `oib-source`, `oib-load`, `oib-compare`, `oib-deploy` including update in place and pilot group assignment, `oib-fix`, `oib-undo`, `oib-validate`).

## Method

Record and replay. A throwaway harness ran the real `handleOib` flows with `fetch` patched: GitHub was read live, and every Graph request the code produced was written out, sent unchanged through Lokka, and its response fed back to the code. The request bodies were built by our own code from the OpenIntuneBaseline pack at main commit `4844247` (Windows v3.8, macOS, Windows 365, BYOD). The only change to the pack content was the name prefix `TenuVault E2E ` so test objects were easy to find. The backup step of update and fix runs was stubbed (backups are outside this scope).

Policies deployed (one per supported type and platform): Windows Settings Catalog (Config Refresh), Windows Endpoint security (Personal Data Encryption), Windows compliance (Password), Windows update ring (Ring 1 Pilot), Windows device configuration (Endpoint Analytics health monitoring), Windows driver update profile (Ring 2 UAT), macOS Settings Catalog (Edge Password Management), macOS compliance (Password), Windows 365 Settings Catalog (Connectivity Settings), Windows 365 compliance (Device Health), BYOD Android and iOS app protection.

## Calls

| Flow | Method and path | Result |
| --- | --- | --- |
| oib-source, oib-load | GitHub `commits/main`, `git/trees/{commit}?recursive=1`, raw files | Pass (all four platforms loaded, 73, 20, 3 and 2 policies) |
| Inventory (compare, deploy clash check) | GET `deviceManagement/configurationPolicies?$select=id,name,description` and every `@odata.nextLink` | Pass (25 per page, five pages followed; the OIBID is read from `description`) |
| Inventory | GET `deviceManagement/deviceCompliancePolicies?$select=id,displayName,description` | Pass |
| Inventory | GET `deviceManagement/deviceConfigurations?$select=id,displayName,description` | Pass |
| Inventory | GET `deviceManagement/windowsDriverUpdateProfiles?$select=id,displayName,description` | Pass |
| Inventory | GET `deviceAppManagement/androidManagedAppProtections?$select=id,displayName,description` and `iosManagedAppProtections` | Pass |
| oib-compare | Matching on the live inventory | Pass (Windows test policies matched by OIBID as current; macOS, Windows 365 and BYOD matched by name) |
| Create | POST `deviceManagement/configurationPolicies` (Settings Catalog and Endpoint security template) | Pass |
| Create | POST `deviceManagement/deviceCompliancePolicies` (Windows and macOS, block action inline) | Pass |
| Create | POST `deviceManagement/deviceConfigurations` (update ring, health monitoring) | Pass |
| Create | POST `deviceManagement/windowsDriverUpdateProfiles` | Not verifiable: 403 with a generic message; the lab has no Windows license with the Autopatch entitlement. Fixed the error shown (see below) |
| Create | POST `deviceAppManagement/androidManagedAppProtections` and `iosManagedAppProtections` | Pass (IDs have the `T_` prefix, accepted by our ID check) |
| Create follow-up | POST `.../{id}/targetApps` (Android, iOS) | Pass (204) |
| Pilot group | POST `deviceManagement/configurationPolicies/{id}/assign`, POST `deviceManagement/deviceCompliancePolicies/{id}/assign` with one `groupAssignmentTarget` | Pass (204; assignment confirmed with GET `.../assignments`). An existing empty static lab group was used |
| Read back (validate, update, undo) | GET `configurationPolicies/{id}?$expand=settings,assignments` | Pass (values lose their `@odata.type` and gain `auditRuleInformation`; validation ignores both) |
| Read back | GET `deviceCompliancePolicies/{id}?$expand=scheduledActionsForRule($expand=scheduledActionConfigurations),assignments` | Pass (adds `version`, `wslDistributions`, rule IDs; ignored) |
| Read back | GET `deviceConfigurations/{id}?$expand=assignments` | Pass |
| oib-validate | Our comparison on the live read-backs | Pass: all nine validated policies compliant right after creation; app protection reported as not validated setting by setting |
| Drift | PATCH on a test compliance policy (minimum password length 8 to 12) made through Lokka | Validation reported exactly that one mismatch |
| oib-fix | PATCH `deviceCompliancePolicies/{id}` then POST `.../scheduleActionsForRules` | Pass; read back matched the baseline and validation was compliant again |
| Update in place | PUT `configurationPolicies/{id}` (after renaming the test policy to an older version) | Pass; name and settings back to the pack version, assignments untouched |
| oib-undo (update and fix runs) | PUT `configurationPolicies/{id}`, PATCH plus POST `scheduleActionsForRules` | Pass; the previous versions were back |
| oib-undo (deploy runs) | DELETE on every created object | Pass (all runs removed from history) |
| After undo | GET on deleted objects | 404, and 400 `ResourceNotFound` for Settings Catalog; both handled |
| Licensing, Defender, Autopatch detection | None | No Graph call: the New Deployment wizard asks the admin. Nothing to verify |
| Administrative templates | None | Not verifiable: the current pack has no administrative templates |

Encrypted OMA-URI values, enrollment configuration exclusions and shared default enrollment names do not apply here: the OIB pack has no custom OMA-URI profiles, enrollment configurations or terms and conditions.

## Fixes

- A driver update profile refused with a bare 403 now fails with an explanation that the tenant needs a Windows license with the Autopatch entitlement, instead of only "An error has occurred".
- The tenant inventory used for comparison and the clash check stopped silently after 100 pages (2,500 Settings Catalog policies at 25 per page), so larger tenants would have seen deployed policies as missing and could have created duplicates. It now follows up to 1,000 pages and fails the comparison if the listing still does not end.
- Tests with recorded, redacted responses: `test/oib-lokka-fixtures.test.ts`.

## Observations (no change made)

- GET `configurationPolicies/{id}?$expand=assignments` returned an empty `assignments` list for Settings Catalog policies that do have assignments (a new pilot assignment and a long-standing one), while `configurationPolicies/{id}/assignments` and the list with `$expand=assignments` returned them. OIB deployments are not affected (updates keep assignments and validation ignores them), but backups and drift checks that rely on the single-object expand are.
- Replacing a policy in place never takes the "Already matches the baseline" path for pack content, because the pack file and the live object differ in shape. The update is still correct; it only writes when nothing changed.
- The scheduled actions sent for a compliance fix still carry the pack's `@odata.id` annotations. Graph accepted and ignored them.
- Fixed after this run: driver update profiles are no longer treated as Enterprise only. Microsoft documentation lists Microsoft 365 Business Premium among the licenses with the Autopatch entitlement that driver updates need.
- The iOS BYOD pack targets one app with the bundle ID `wefwef`, which comes from the upstream export.

## Cleanup

Every test object was deleted through our undo flow. Final listings of Settings Catalog, compliance, device configuration, driver update profile and Android and iOS app protection policies show no object with the `TenuVault E2E ` prefix. No group was created or changed.
