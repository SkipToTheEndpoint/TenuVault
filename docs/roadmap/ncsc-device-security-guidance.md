# UK NCSC Device Security Guidance framework

## What it does

Adds "UK NCSC Device Security Guidance" (id `ncsc-dsg`, publisher UK National Cyber Security
Centre, kind Baseline) to the framework catalog as a policy-pack framework. **Load NCSC Windows
2025** downloads the nine Windows Settings Catalog exports from
https://github.com/ukncsc/Device-Security-Guidance-Configuration-Packs at the pinned commit
`681e07584d3f7a84549ff26bda83e4f1480703f6` (2026-03-04) and compares them with the tenant's
Settings Catalog policies using the existing pack assessment (`comparePolicies`). Saved
assessments export as PDF, CSV and JSON like every other pack framework.

Implementation: `src/main/frameworks/ncsc.ts` (loader), action `load-ncsc` in
`src/main/frameworks/service.ts`, catalog entry and `NCSC_COMMIT` in
`src/shared/frameworks/catalog.ts`, UI in `src/renderer/pages/FrameworksPage.tsx`.

## Plan boundary

Free on Community, Pro and MSP: loading, assessment, workspace history and PDF, CSV and JSON
exports. `plan-gates.ts` treats only `CIS_FRAMEWORKS` as paid; `test/ncsc-framework.test.ts`
checks every NCSC action against `requiredFeature` and `planGuard` for all three plans.

## Assessed and not assessed

| Content at the pinned commit | Status | Reason |
| --- | --- | --- |
| `Microsoft/Windows/MDM/Configurations/SettingsCatalog/*.json` (9 policies, 187 root settings) | Assessed | Settings Catalog export, parsed by `parsePolicies` after UTF-16 decoding |
| `EndpointSecurity/*.json` (Account Protection, Application Control) | Not assessed | `deviceManagementIntent` (legacy endpoint security template) exports; the `_Settings.json` files are JSON-encoded strings. `parsePolicies` rejects both |
| `DeviceConfiguration/2025-NCSC-Surface-DFCI.json` | Not assessed | `windows10DeviceFirmwareConfigurationInterface` legacy device configuration |
| `AppLocker/*.xml` | Not assessed | Rule XML, not an Intune policy export |
| Apple iOS / macOS | Not assessed | `.mobileconfig`, shell script, CSV and Markdown |
| Android, ChromeOS | Not assessed | CSV and Markdown only |

The pack configures about ten settings in more than one policy with different values; these
show as **Review**, which is the existing behavior for alternative pack values.

## Limits and safety

- Fixed file allow-list at a pinned commit; the request cannot supply a URL, path or commit.
- Each file must match a reviewed SHA-256 of its raw bytes (1 MB per-file limit, checked from
  `content-length` and the body). One failed download, hash mismatch or parse error fails the
  whole load; no partial pack is returned.
- The files are UTF-16LE with a byte order mark (GitHub serves `text/plain; charset=utf-16`).
  `decodePackFile` handles UTF-16LE and UTF-8 and rejects other encodings.
- **Comparison only.** The generic "create missing settings as unassigned policies" step is
  hidden in the UI and refused in the main process (403) for `comparisonOnly` frameworks,
  whether the create request names the framework or only the run ID. This is a product scope
  rule, not a content lock: an admin who imports the same NCSC JSON under Custom Baselines uses
  the normal create flow for their own imported mappings, which the Apache License permits.
- No new Graph calls. The assessment uses the existing reads
  `GET /beta/deviceManagement/configurationPolicies`, `/{id}/settings` and `/{id}/assignments`.

## License analysis

- License: Apache License 2.0 (repository `LICENSE`), "Copyright 2025 Crown Copyright"
  (repository README). No `NOTICE` file exists in the repository at the pinned commit.
- Section 2 allows reproduction, derivative works and distribution. Obligations under section 4
  and how they are met:
  - 4(a) copy of the license: `resources/licenses/ncsc-device-security-guidance-LICENSE.txt`
    (attribution preamble plus the verbatim license) and `test/fixtures/ncsc/LICENSE` next to
    the two fixture files. The UI links to the license at the pinned commit.
  - 4(b) notice of modification: the catalog `licenseNotice` ("Modified for comparison"), the
    per-policy provenance field `modifications`, the license file preamble and the UI source line
    state that files are decoded from UTF-16 and that export metadata, IDs, assignments and scope
    tags are removed.
  - 4(c) retain attribution notices: Crown Copyright and the source repository are named in the
    UI, the provenance of every loaded policy, every export notice and the docs.
  - 4(d) NOTICE file: none upstream, nothing to carry.
- Section 6 (trademarks): no NCSC logo or mark is used. The catalog shows the text monogram
  "NCSC" as a source identifier, like other publishers, and every surface states "No endorsement
  by NCSC".
- The pack content is downloaded by the admin's app from GitHub at run time and is not bundled in
  the installer. Saved assessments and exports contain derived (modified) settings, which is why
  the notice travels with every export (`workspaceReportHeader` appends the framework's
  `licenseNotice`).

## Manual verification

1. Open Frameworks. "UK NCSC Device Security Guidance" appears under "Baselines and policy
   packs" with the NCSC monogram and "Windows pack included · PDF, CSV and JSON reports"; it is
   also listed in the sidebar framework list.
2. Open it on a Community tenant. The coverage box shows the coverage text and the license
   notice. The Source button opens the GitHub repository.
3. Click **Load NCSC Windows 2025**. "9 policies loaded" appears, the source version is filled in
   with "UK NCSC Device Security Guidance 2025 Windows Settings Catalog · 681e075", and the source
   line shows Crown Copyright with a working Apache License 2.0 link at the pinned commit.
4. Disconnect the network and click the load button again: an error appears and the previously
   loaded pack is unchanged.
5. Click **Run comparison**. Findings appear; finding checkboxes are disabled and the footer says
   the pack is for comparison and reports only. No "Preview recommended policies" button is shown.
6. Export PDF, CSV and JSON. Each includes the notice "Contains NCSC configuration packs, Crown
   Copyright, licensed under the Apache License 2.0. Modified for comparison. No endorsement by
   NCSC." The JSON contains per-policy provenance with commit, SHA-256 and license.
7. Repeat steps 3 to 6 on a Pro and an MSP tenant: identical behavior, no upgrade prompts.
8. Open OpenIntuneBaseline: the create flow is unchanged there.

## Follow-ups

- Package the license file: add `{ from: "resources/licenses", to: "licenses" }` to
  `extraResources` in `electron-builder.config.cjs` (not owned by this change) so the text ships
  with the installer, and link it from the NCSC source line.
- Deployment of the NCSC pack (backup first, undo by run) through a path like the
  OpenIntuneBaseline section's deployment, and optionally enabling the per-setting create step. Deliberately not added.
- Assess the endpoint security intent and DFCI exports once the pack assessment supports those
  policy families.
- When NCSC publishes a new pack, review the license, update `NCSC_COMMIT`, the file list and
  the reviewed hashes together.
