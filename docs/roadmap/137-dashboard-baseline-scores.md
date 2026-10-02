# Dashboard baseline scores (#137)

## What it does

Governance > Baseline scores (`/portal/governance/scores`) and a Baseline score tile on the
dashboard show a technical score per framework, computed from the native framework
comparisons the Frameworks page already saved on this device
(`framework.native.v1.<tenant>.<framework>`, up to 20 runs). The scores route reads them
through `POST /api/frameworks { action: "native-history" }` and never starts a collection or
calls Microsoft Graph. No score is stored; every answer is computed from the saved runs.

Per framework the screen shows: framework name, version, profile (Essential Eight maturity
level, Def Stan risk level, otherwise Default), mapping ruleset version, tenant, assessment
date and age, assessed platforms (scope), score, evaluated coverage, unknown count, the
number of gaps, the top five actionable gaps and the trend. "Controls and gaps" drills down
to every source control and every gap of the newest comparison. A framework without a saved comparison shows no score.

## Scoring formula

Implemented in `src/main/features/scores/formula.ts` (`scoreFromCounts`, `scoreRun`). Counting
reuses `comparisonCounts` from `src/shared/compliance/native.ts`, so the numbers match the
Frameworks page.

- matching, different, missing: setting checks the comparison evaluated.
- unknown: checks and requirements marked "unable to check" (collection failed, unreadable
  value, no detector).
- outside scope: checks for platforms left out of the comparison. Not counted anywhere.

```
evaluated = matching + different + missing
score     = matching / evaluated              (one decimal, percent)
coverage  = evaluated / (evaluated + unknown) (one decimal, percent)
```

- `evaluated = 0` means "Not scored" with the reason. It is never 0 % or 100 %.
- Unknown results never enter the score; they lower coverage instead.
- Top gaps are capabilities with at least one different or missing setting, ordered by the
  the gap ranking criteria (`src/main/features/scores/gap-ranking.ts`).
- A comparison older than 30 days is marked stale. Incomplete collection families are shown
  as "Partial collection".

## OpenIntuneBaseline validations

Saved OIB Policy Validation runs also produce scores, one card per platform (Windows,
macOS, Windows 365 and BYOD), through `/api/oib`'s `oib-validations` action. The dashboard
and MSP portfolio use the same projections. The score covers only the selected deployed
policies. It does not include undeployed or unselected policies, assignments or device
enforcement. Each card and the dashboard identify this scope; Open comparison returns to
OIB Policy Validation.

Counts use expected root settings, not individual leaf differences. New validations save
complete matching/different/missing counts independently of the bounded detail lists and
retain the expected setting count when a policy cannot be read. Failed reads stay unknown.
Older truncated results retain unknown settings rather than guessing they matched. For
unsupported or historical failed policies whose setting count is unknown, coverage is
withheld and the unknown entry represents one policy, not one setting.

OIB trends require the same source commit, platform, comparison version and selected
source/target policy pairs. Changing any of them starts a separate trend. Historical
validations remain readable, but do not connect to the newly versioned comparisons.
No migration, tenant write or automatic assessment is performed. Removing this projection
does not delete the saved validations.

Automated coverage: `test/feature-scores-oib.test.ts` exercises scores, gaps, failed and
truncated evidence, selection-compatible trends, source failures, Pro/Community gates and
MSP tenant isolation.

## Trends

`buildTrend` connects only comparisons whose framework, framework version, mapping ruleset
(version and content hash), profile and assessed platforms equal those of the newest one.
The profile only counts for frameworks that have one (Essential Eight, Def Stan). Every other
comparison is listed as "not connected to this trend" with the reason, for example
"Framework version changed (2.0 and 2.1)". A comparison without a score stays in the trend as
a break in the line.

## Plan boundary

- Community: the existing Frameworks page comparisons, unchanged. The scores screen shows the
  locked preview and the dashboard tile a badged teaser with no score. `summary`, `detail`
  and `portfolio-summary` answer 402.
- Pro: `summary` and `detail` for the selected tenant.
- MSP: `portfolio-summary` with `targetTenants`, one row per tenant and framework with its
  own score, coverage, unknown count, assessment date, stale and partial flags. The renderer
  passes only connected tenants licensed for MSP and lists the rest as not included. A tenant
  whose reads fail is shown as unavailable without hiding the others. "Controls" drills down
  with `detail` for that tenant.
- Downgrade: nothing is stored by this feature, so nothing is lost. The saved comparisons stay
  on the Frameworks page.

## Limits

- The score describes configuration compared with a technical mapping. It does not prove
  enforcement on devices, effective access or compliance with the whole framework.
- Reading every framework's history parses up to 20 saved runs per framework; very large
  histories make the first load slower.

## Manual verification

1. On a Pro tenant, open Frameworks, compare NIST CSF 2.0 for Windows and Conditional Access.
2. Open Governance > Baseline scores. Check the score, coverage and counts line against the
   counts on the Frameworks page for the same run. The tenant, version, profile, date and
   scope must match.
3. Compare again with the same scope, then refresh: the trend has two points. Compare again
   with only Windows: the new run is the anchor and the earlier ones are listed as not
   connected with "Assessed platforms changed".
4. With Conditional Access excluded from consent (or signed out of Graph during a
   comparison), check that the card shows "Partial collection" and a coverage below 100 %.
5. Open the dashboard: the Baseline score tile shows the newest framework score and links to
   the scores screen.
6. Switch to a Community tenant: the tile shows the Pro badge without a score, the scores
   screen shows the locked preview, and the Frameworks page still compares.
7. On MSP with two tenants, load the portfolio: both tenants are listed with their own dates
   and coverage; "Controls" opens the other tenant's controls.
8. Automated: `npx vitest run test/feature-scores.test.ts`.
