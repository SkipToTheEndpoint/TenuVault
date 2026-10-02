import type { Tenant } from "~/contexts/TenantContext"
import type { FeatureRoutePath } from "../../../shared/feature-routes"
import { featureCall } from "../../lib/feature-api"
import type { BaselineInstallRecord, ComparisonRecord, UpgradeRecord } from "../../../main/features/baseline-upgrades/service"
import type { ChangeSet, ChangeSetActions, ChangeSetPreview, RollbackPreview } from "../shared/change-set"

type Stored<T> = T & { id: string; tenantId: string; createdAt: string; updatedAt: string }
export type Install = Stored<BaselineInstallRecord>
export type Upgrade = Stored<UpgradeRecord>
export type Comparison = Stored<ComparisonRecord>
export interface RunOption { runId: string; platform: string; reference: string; createdAt: string; policies: number; recorded: boolean }
export interface ReleaseOption { platform: string; tag: string; commit: string; reference: string; publishedAt?: string }

const PATH = "/api/baseline-upgrades"

export const listBaselines = (tenant: Tenant) => featureCall<{ installs: Install[]; upgrades: Upgrade[] }>(PATH, tenant, "list")
export const getUpgrade = (tenant: Tenant, id: string) => featureCall<{ upgrade: Upgrade; comparison: Comparison; changeSets: ChangeSet[] }>(PATH, tenant, "get", { id })
export const baselineSources = (tenant: Tenant) => featureCall<{ runs: RunOption[] }>(PATH, tenant, "sources")
export const recordInstall = (tenant: Tenant, runId: string) => featureCall<{ install: Install }>(PATH, tenant, "record-install", { origin: "quickstart", runId })
export const checkReleases = (tenant: Tenant, installId: string) => featureCall<{ releases: ReleaseOption[]; warning?: string }>(PATH, tenant, "releases", { installId })
export const compareRelease = (tenant: Tenant, installId: string, commit: string | null) => featureCall<{ upgrade: Upgrade }>(PATH, tenant, "compare", { installId, commit })
export const resolveUpgrade = (tenant: Tenant, id: string, settings: Array<{ policyKey: string; settingKey: string; choice: "local" | "upstream" }>, policies: Array<{ policyKey: string; choice: string }>) =>
  featureCall<{ upgrade: Upgrade }>(PATH, tenant, "resolve", { id, settings, policies })
export const createUpgradeChangeSet = (tenant: Tenant, id: string, policyKeys: string[] | null) => featureCall<{ upgrade: Upgrade; changeSet: ChangeSet }>(PATH, tenant, "create-change-set", { id, policyKeys })
export const discardUpgrade = (tenant: Tenant, id: string, reason: string) => featureCall<{ upgrade: Upgrade }>(PATH, tenant, "discard", { id, reason })

/**
 * Review, apply and rollback calls of one change set through the workflow route that created it
 * (`<prefix>change-...` actions). The route checks that the change set belongs to the record.
 */
export function workflowChangeActions(path: FeatureRoutePath, prefix: string, tenant: Tenant, recordId: string, changeSetId: string): ChangeSetActions {
  const base = { id: recordId, changeSetId }
  const apply = (contentHash: string) => featureCall(path, tenant, `${prefix}change-apply`, { ...base, contentHash, confirm: true })
  return {
    preview: () => featureCall<ChangeSetPreview>(path, tenant, `${prefix}change-preview`, base),
    approve: (input) => featureCall(path, tenant, `${prefix}change-approve`, { ...base, ...input }),
    reject: (input) => featureCall(path, tenant, `${prefix}change-reject`, { ...base, ...input }),
    apply,
    retry: apply,
    rollbackPreview: () => featureCall<RollbackPreview>(path, tenant, `${prefix}change-rollback-preview`, base),
    rollbackCreate: () => featureCall<{ changeSet: ChangeSet }>(path, tenant, `${prefix}change-rollback-create`, base),
  }
}

export const KIND_LABEL: Record<string, string> = {
  unchanged: "unchanged",
  "upstream-added": "added by release",
  "upstream-removed": "removed by release",
  "upstream-changed": "changed by release",
  "local-kept": "your customization, kept",
  converged: "same change on both sides",
  conflict: "conflicting edit",
  "type-changed": "data type changed",
  unsupported: "not merged (manual)",
  "unknown-base": "difference, source unknown",
}
