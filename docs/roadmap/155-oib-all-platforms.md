# 155: Basic public OpenIntuneBaseline deployment and comparison on every platform

Superseded: Quick Start and the OIB framework catalog entry described below were replaced by the
OpenIntuneBaseline section (`/portal/oib`), which reads the latest `main` commit instead of a
pinned commit and releases. See [frameworks](../frameworks.md#openintunebaseline).

## What it does

Community deploys (Quick Start) and compares (Framework coverage) the public OpenIntuneBaseline
packs for every supported platform: Windows, macOS, Windows 365 and BYOD app protection, at the
tested (pinned) commit and every offered release that descends from it. The deploy flow is
unchanged: preview, explicit confirmation, backup first (fails closed), create unassigned or for
the pilot group only, skip existing, journaled writes, run record after every object, undo.

The pack preview now lists files of the platform folder that Quick Start does not deploy (scripts,
unsupported folders or policy types) with the reason (`unsupportedArtifacts` in
`src/main/frameworks/quickstart.ts`), and states that source assignments are not deployed and
scope tags reset to Default. Provenance (commit, reference, source URL, GPL-3.0 attribution) is
kept on the pack and the page.

## Plan boundary (takes effect with the next release)

- Community: every platform and offered release, one licensed tenant. A second tenant is refused
  at token acquisition (license check in the fetch bridge) before any backup or write.
- Pro: two tenants, still one tenant per run.
- MSP: "Also deploy to" several tenants in one run. Each deploy of such a run carries `batch: true`
  and `plan-gates.ts` requires `bulkActions` on every tenant it reaches. A single-tenant deploy
  repeated by hand is equivalent and allowed within the plan's tenant count.
- Customization-preserving upgrades (Pro) and framework report exports keep their own gates.

## Limits

- Only the Quick Start pack folders are deployed; everything else is listed as not deployed.
- Releases whose commit does not descend from the pinned commit are not offered.
- No new Microsoft Graph endpoints: the existing reads and writes are reused.

## Manual verification

1. Community tenant with backup storage. Frameworks, OpenIntuneBaseline. The Quick Start header
   shows "All platforms and releases"; no platform button or release option has a badge.
2. Choose macOS, Preview pack: the preview lists the policies and, if any, the files not deployed.
3. Back up and deploy: a backup runs first, then policies are created unassigned. Undo removes
   exactly those policies.
4. Choose Windows 365 and a newer release; preview and deploy work the same.
5. "Also deploy to" shows an MSP badge on Community and Pro. On MSP, tick a second tenant and
   deploy: both tenants are backed up first and deployed one after another.
6. Add a second tenant on Community and try to deploy there: refused with "Community covers one
   tenant" and nothing is backed up or created.
