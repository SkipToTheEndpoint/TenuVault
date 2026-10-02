# #148 Versioned golden standards and customer overlays

## What it does

Route: `POST /api/standards`, screen: Governance, Standards and customizations.

- Organization customizations (Pro, `customizations`): `create-customization`,
  `revise-customization` (new version, history kept), `retire-customization`. A customization
  documents a deliberate deviation from the installed baseline: setting, value, reason, owner.
  Baseline upgrades (#144) mark kept tenant settings that are documented.
- Golden standards (MSP, `standard-...` actions, `goldenStandards`): immutable versions stored in
  the shared record scope. `standard-create` publishes version 1 from an OIB version (the
  OpenIntuneBaseline loader) or Settings Catalog exports; `standard-publish-version` publishes the next
  version and must start from the latest one (a stale predecessor answers 409). Each version has
  source provenance, change notes, a typed parameter schema (string, integer with range, choice
  with options, reference) and parameter bindings. IDs, assignments, scope tags and timestamps
  are dropped, secrets are refused, tenant references must be bound to a reference parameter and
  are stored without a value, and content that contains a connected tenant ID is refused.
  `get-standard-diff` (stored versions only, readable on every plan) lists changed policies,
  settings and parameters.
- Customer adoptions (MSP, the request's tenantId is the customer): `standard-adopt`,
  `standard-configure` (parameters, overlay settings and removals, approved exceptions with
  reason, approver and expiry, the target policy per standard policy, the target version),
  `standard-preview`, `standard-plan`, `standard-assess`, and review, apply and rollback through
  `standard-change-preview`, `standard-change-approve`, `standard-change-reject`,
  `standard-change-apply`, `standard-change-rollback-preview`, `standard-change-rollback-create`.
  The overlay and exceptions live in the customer's adoption record, never in the standard.
- Preview computes the effective settings (base, parameter values, overlay) and reports
  conflicts (overlay on a parameter-bound setting, duplicate or contradicting overlay entries,
  changed data type, overlay and exception on the same setting) and blockers (missing parameter
  values, unknown policies, missing or unreadable mapped policies, wrong platform, reusable
  settings that do not exist in this customer). Plan refuses on any conflict or blocker.
- A new version changes no customer. Retargeting migrates parameters (renamed carried over,
  removed listed and acknowledged, new required ones blocking) and is applied only through a
  reviewed change set (origin `standard-adoption`). Customer name, description, scope tags and
  assignments of existing policies stay.
- Tracking per customer: adopted version, configured version, latest version (pending upgrade),
  deviation from the last live assessment (approved unexpired exceptions are shown as excepted,
  never as matching), unknown policies (unmapped, missing, unreadable) and freshness (stale after
  7 days). `portfolio-adoptions` reports this across the named `targetTenants`.
- Signals: pending upgrade, deviation, stale or missing assessment, unknown policies,
  partial, failed or uncertain adoption.

## Plan boundary

Community: unavailable (stored records stay readable through `list-...`/`get-...`). Pro:
organization customizations. MSP: standards, adoptions and the portfolio. Customer actions check
the customer tenant's plan; the portfolio checks every target.

## Limits

- Settings Catalog policies; one adoption per standard and customer; at most 25 changed policies
  per change set.
- Overlay values are entered as setting instance JSON.
- Group membership is not read; assignments are never changed.

## Graph calls

`GET deviceManagement/configurationPolicies/{id}?$expand=settings,assignments` and
`GET deviceManagement/reusablePolicySettings?$select=id,displayName` (verified read-only with
Lokka on beta: a `value` collection of objects with `id`, `displayName`, `settingDefinitionId`,
paged with `@odata.nextLink`), plus the change-set engine's writes.

## Manual verification

1. On an MSP license with two customer tenants, publish a standard from two Settings Catalog
   exports with an integer and a string parameter. Check that the stored standard has no tenant
   or policy IDs.
2. Select customer A, adopt the standard, preview: expect blockers for missing mappings and the
   required string parameter. Configure them, map one policy to an existing policy and one to
   "create", preview again and create the change set. Review, approve and apply; expect verified
   operations and "Adopted v1".
3. Publish version 2 renaming a parameter and removing another. Customer A is unchanged in Intune
   and shows "upgrade available". Configure for version 2: the renamed value carries over and the
   removed one is listed; creating the change set requires the acknowledgment.
4. Change a setting in Intune, assess: one deviation. Add an approved exception for it, assess:
   excepted, not matching.
5. Select customer B: A's adoption is not listed and its ID answers 404.
6. Load the portfolio: both tenants are listed with adopted version, pending upgrade and
   freshness.
7. On a Pro license, document an organization customization; the MSP sections show the plan
   badge. On Community, customizations answer with the upgrade prompt and stored ones stay listed.
