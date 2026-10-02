import type { Tenant } from "~/contexts/TenantContext"
import { featureCall } from "../../lib/feature-api"
import type { BaselineRecord, ComparisonRecord, DeploymentRecord, RebaseRecord, VersionRecord } from "../../../main/features/custom-baselines/service"
import type { NonPortable, SettingView } from "../../../main/features/custom-baselines/model"
import type { SnapshotOption } from "../../../main/features/custom-baselines/snapshot"
import type { ChangeSet } from "../shared/change-set"

type Stored<T> = T & { id: string; tenantId: string; createdAt: string; updatedAt: string }
export type Baseline = Stored<BaselineRecord>
export type Deployment = Stored<DeploymentRecord>
export type Rebase = Stored<RebaseRecord>
export type Comparison = Stored<ComparisonRecord>
export type { SnapshotOption, SettingView }

export interface VersionPolicyView {
  key: string
  name: string
  platforms: string | null
  technologies: string | null
  nonPortable: NonPortable[]
  settings: SettingView[]
}
export type VersionView = Omit<Stored<VersionRecord>, "policies"> & { policies: VersionPolicyView[] }

export type EditInput =
  | { type: "set"; policyKey: string; settingKey: string; path: string; value: string | number }
  | { type: "remove-setting"; policyKey: string; settingKey: string }
  | { type: "remove-policy"; policyKey: string }

export type FrameworkInput =
  | { kind: "oib"; platform: string; commit: string }
  | { kind: "ncsc" }
  | { kind: "workspace"; frameworkId: string }
  | { kind: "native"; frameworkId: string; scope?: { platforms: string[]; essentialEightMaturityLevel: number; defStanRiskLevel: number } }

export const PATH = "/api/custom-baselines" as const

export const listCustomBaselines = (tenant: Tenant) => featureCall<{ baselines: Baseline[]; deployments: Deployment[]; comparisons: Comparison[] }>(PATH, tenant, "list")
export const getCustomBaseline = (tenant: Tenant, id: string, version?: number) => featureCall<{ baseline: Baseline; version: VersionView; rebases: Rebase[] }>(PATH, tenant, "get", { id, ...(version ? { version } : {}) })
export const getDeployment = (tenant: Tenant, id: string) => featureCall<{ deployment: Deployment; changeSets: ChangeSet[] }>(PATH, tenant, "get", { kind: "deployment", id })
export const getComparison = (tenant: Tenant, id: string) => featureCall<{ comparison: Comparison }>(PATH, tenant, "get", { kind: "comparison", id })
export const customizeOib = (tenant: Tenant, platform: string, commit: string, name?: string, releaseTag?: string) => featureCall<{ baseline: Baseline }>(PATH, tenant, "customize", { platform, commit, ...(name ? { name } : {}), ...(releaseTag ? { releaseTag } : {}) })
export const listSnapshots = (tenant: Tenant) => featureCall<{ snapshots: SnapshotOption[] }>(PATH, tenant, "snapshots")
export const createFromSnapshot = (tenant: Tenant, backupId: string, name?: string) => featureCall<{ baseline: Baseline }>(PATH, tenant, "from-snapshot", { backupId, ...(name ? { name } : {}) })
export const saveVersion = (tenant: Tenant, id: string, input: { fromVersion: number; name?: string; note: string; edits: EditInput[] }) => featureCall<{ baseline: Baseline }>(PATH, tenant, "save-version", { id, ...input })
export const checkReleases = (tenant: Tenant, id: string) => featureCall<{ releases: Array<{ tag: string; commit: string; reference: string }>; warning?: string }>(PATH, tenant, "releases", { id })
export const compareRebase = (tenant: Tenant, id: string, commit: string) => featureCall<{ rebase: Rebase }>(PATH, tenant, "rebase-compare", { id, commit })
export const resolveRebase = (tenant: Tenant, rebaseId: string, settings: Array<{ policyKey: string; settingKey: string; choice: "local" | "upstream" }>, policies: Array<{ policyKey: string; choice: string }>) => featureCall<{ rebase: Rebase }>(PATH, tenant, "rebase-resolve", { rebaseId, settings, policies })
export const applyRebase = (tenant: Tenant, rebaseId: string, note?: string) => featureCall<{ baseline: Baseline }>(PATH, tenant, "rebase-apply", { rebaseId, ...(note ? { note } : {}) })
export const discardRebase = (tenant: Tenant, rebaseId: string) => featureCall<{ rebase: Rebase }>(PATH, tenant, "rebase-discard", { rebaseId })
/**
 * Deploys a version into `target`. For a baseline of another tenant the owner is named as
 * `sourceTenantId` and in `targetTenants`, so the main process checks both licenses.
 */
export const deployBaseline = (target: Tenant, owner: string, id: string, version: number, policyKeys: string[] | null) => {
  const own = target.credentials?.tenantId.toLowerCase() === owner.toLowerCase()
  return featureCall<{ deployment: Deployment; changeSet: ChangeSet }>(PATH, target, "deploy", { id, version, policyKeys, ...(own ? {} : { sourceTenantId: owner, targetTenants: [{ tenantId: owner }] }) })
}
export const compareTenant = (tenant: Tenant, id: string, version: number, source: "backup" | "live") => featureCall<{ comparison: Comparison }>(PATH, tenant, "compare-tenant", { id, version, source })
export const compareFramework = (tenant: Tenant, id: string, version: number, framework: FrameworkInput) => featureCall<{ comparison: Comparison }>(PATH, tenant, "compare-framework", { id, version, framework })
