# #144 Baseline upgrades preserving customizations

## What it does

Upgrades an installed OpenIntuneBaseline (or a framework workspace pack) to a newer release
while keeping the tenant's own changes. Route: `POST /api/baseline-upgrades`, screen: Changes,
Baseline upgrades.

1. Provenance: `record-install` turns an OpenIntuneBaseline deployment run (or a Quick Start run
   migrated into the OpenIntuneBaseline history) into an installed baseline. The run's recorded
   commit is used (never a guess; migrated Quick Start runs carry one only if they used the
   previously pinned release), the pack is loaded at that commit with the OpenIntuneBaseline
   loader and its policies are frozen as a source record. Each created
   policy ID is linked to its source policy. A workspace pack can be recorded too; its policies
   map to tenant objects only through IDs the workspace recorded or IDs the admin names.
   When the run has no known commit (for example a migrated Quick Start run of a non-pinned
   release), the baseline is recorded with unknown provenance.
2. Releases: `releases` offers the latest OpenIntuneBaseline `main` commit when it differs from the
   installed one and remembers it for the pending-upgrade signal.
3. Compare: `compare` reads every installed Settings Catalog policy live (Graph GET) and compares
   per setting the installed source (base), the tenant (local) and the new release (upstream):
   added, removed or changed by the release, tenant customization kept, the same change on both
   sides, conflicting edit, changed data type, unsupported (secret or tenant-specific reference
   values, never merged). Names and descriptions follow the release only where the tenant kept
   the installed text. A changed platform, technology or template blocks the policy. Settings
   documented as organization customizations (#148) are marked. Without provenance every
   difference needs a decision (manual reviewed comparison); nothing is merged by guessing.
4. Resolve: `resolve` stores a choice (tenant or release value) for every conflicting edit,
   changed data type or unattributable difference, and whether new release policies are created
   and removed ones deleted (default: create new ones, keep removed ones).
5. Change set: `create-change-set` refuses while anything is unresolved and re-reads each tenant
   policy; if it changed after the comparison the upgrade becomes stale and must be compared
   again. The merged policies become one reviewed change set (origin `baseline-upgrade`, at most
   25 operations, split by selecting policies). Assignments are never part of it.
6. Review, apply and rollback happen in the same screen through `change-preview`,
   `change-approve`, `change-reject`, `change-apply` (also the retry), `change-rollback-preview`
   and `change-rollback-create`: approval bound to content and target state, pre-change backup
   (fail closed), capture, journaled writes, read-back.
7. Outcomes: verified operations advance the installed source of their policy, so the next
   comparison uses the new release as its base. Failed ones keep the old source (the baseline
   becomes `mixed`). When the upgrade lands, the customization version increases and the upgrade
   records the chosen resolutions, the source and target versions and a hash of the resulting
   customizations. An applied rollback returns the affected policies to their previous source.

## Plan boundary

- Community: stored records stay readable (`list`, `get`). The manual comparison of a pack
  against the tenant is the free framework comparison on the Frameworks page; the in-route manual
  comparison is part of Pro because every non-read action of this route needs `baselineUpgrades`.
- Pro and MSP: everything above. After a downgrade, stored installs, upgrades and change sets
  stay readable; new comparisons and writes answer 402.

## Limits

- Settings Catalog policies only. Other policy types in a pack are listed for manual review.
- Policies with masked secret values cannot be written back and are upgraded manually.
- A deleted tenant policy is not recreated by the upgrade.
- Group names are never needed; assignments are left untouched.
- Signals: unknown provenance, newer release available, unresolved conflicts, partial or
  uncertain and stale upgrades.

## Graph calls

`GET deviceManagement/configurationPolicies/{id}?$expand=settings,assignments` (through the
backup reader), and the change-set engine's verified reads and writes. Verified read-only with
Lokka against the beta endpoint: detail responses carry `settings[].settingInstance` with
`@odata.type`, `settingDefinitionId`, `settingInstanceTemplateReference` and value members, plus
null members such as `auditRuleInformation` that the comparison ignores.

## Manual verification

1. On a Pro tenant, deploy OIB Windows in the OpenIntuneBaseline section (or use a migrated
   Quick Start run of an older release).
2. In Intune, change one OIB setting in one policy, remove a setting in another.
3. Changes, Baseline upgrades: record the deployment run. Expect status `tracked` with the
   release reference.
4. Check for newer releases and compare with the newest. Expect your edits as "your
   customization, kept", release changes as "changed by release", and a conflict where both
   changed the same setting. Create change set is refused until each conflict is resolved.
5. Resolve, create the change set, preview, approve and apply. Expect a pre-change backup, then
   verified operations. Confirm in Intune that your edits are still there and assignments are
   unchanged. The baseline now shows the new release and customization version 2.
6. Edit a policy in Intune after a comparison and before creating the change set. Expect a
   refusal and the upgrade marked stale.
7. Preview the rollback, create it, approve and apply it. Expect the policies back at the
   previous values and the baseline at the previous source.
8. Switch the license to Community. The installed baseline and upgrade stay listed read-only;
   compare answers with the upgrade prompt.
