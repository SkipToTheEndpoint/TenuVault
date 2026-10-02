import type { RouteModule } from "../../api/host"
import { isGraphId } from "../../../shared/security"
import type { SignalProvider } from "../contracts"
import type { FeatureDeps } from "../deps"
import { featureRoute, FeatureError, optionalText, text, type Body } from "../route"
import type { Choice } from "./merge"
import { defaultSources, type BaselineSources } from "./sources"
import { changeSetActions } from "./change-actions"
import { listChangeSets } from "../change-sets/engine"
import {
  baselineSignals,
  checkReleases,
  compareUpgrade,
  createUpgradeChangeSet,
  discardUpgrade,
  getComparison,
  getInstall,
  getUpgrade,
  listInstalls,
  listUpgrades,
  recordQuickStartInstall,
  recordWorkspaceInstall,
  resolveUpgrade,
  syncUpgrade,
  type UpgradePolicy,
} from "./service"

const idOf = (body: Body, key = "id"): string => {
  const id = text(body, key, 100)
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new FeatureError(`Invalid ${key}`)
  return id
}

const list = (value: unknown, max: number, what: string): Record<string, unknown>[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > max) throw new FeatureError(`Invalid ${what}`)
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new FeatureError(`Invalid ${what}`)
    return entry as Record<string, unknown>
  })
}

const key = (value: unknown, what: string): string => {
  if (typeof value !== "string" || !value || value.length > 500) throw new FeatureError(`Invalid ${what}`)
  return value
}

/** Strips a record's history for list answers. */
const plain = <T extends { history?: unknown }>(record: T) => {
  const { history: _history, ...rest } = record
  return rest
}

/**
 * /api/baseline-upgrades (#144). Pro and MSP. `list` and `get` return stored records on every
 * plan (after bookkeeping of change-set outcomes). Every tenant write is a change set with
 * origin "baseline-upgrade", reviewed, applied and rolled back through this route's
 * `change-...` actions (engine: approval binding, pre-change backup, journaled writes, read-back).
 */
export function routes(deps: FeatureDeps, sources: BaselineSources = defaultSources): Record<string, RouteModule> {
  return featureRoute("/api/baseline-upgrades", deps, {
    // Review, apply and rollback of the change sets this workflow created.
    ...changeSetActions(deps, { prefix: "", workflow: "baseline-upgrade", exists: (tenantId, id) => void getUpgrade(deps, tenantId, id), sync: (tenantId, id) => syncUpgrade(deps, tenantId, id) }),
    list: ({ tenantId }) => {
      const upgrades = listUpgrades(deps, tenantId).map((upgrade) => syncUpgrade(deps, tenantId, upgrade.id))
      return { installs: listInstalls(deps, tenantId).map(plain), upgrades: upgrades.map(plain) }
    },
    get: ({ tenantId, body }) => {
      const id = idOf(body)
      if (body.kind === "install") return { install: getInstall(deps, tenantId, id) }
      const upgrade = syncUpgrade(deps, tenantId, id)
      const changeSets = listChangeSets(deps, tenantId).filter((entry) => entry.origin.workflow === "baseline-upgrade" && entry.origin.recordId === id)
      return { upgrade, comparison: plain(getComparison(deps, tenantId, upgrade.comparisonId)), changeSets }
    },

    /** OpenIntuneBaseline deployment runs of this tenant (including migrated Quick Start runs) that can be recorded as installed baselines. */
    sources: ({ tenantId }) => {
      let runs: ReturnType<BaselineSources["runs"]>
      try {
        runs = sources.runs(tenantId)
      } catch {
        runs = []
      }
      const recorded = new Set(listInstalls(deps, tenantId).flatMap((install) => (install.origin.type === "quickstart" ? [install.origin.runId] : [])))
      return { runs: runs.map((run) => ({ runId: run.runId, platform: run.platform, reference: run.reference, createdAt: run.createdAt, policies: run.created.length + run.updated.length, recorded: recorded.has(run.runId) })) }
    },
    "record-install": async ({ tenantId, body, actor }) => {
      if (body.origin === "quickstart") return { install: await recordQuickStartInstall(deps, sources, tenantId, idOf(body, "runId"), actor) }
      if (body.origin === "workspace") {
        const frameworkId = text(body, "frameworkId", 100)
        if (!/^[a-z0-9-]+$/.test(frameworkId)) throw new FeatureError("Invalid framework")
        const mappings: Record<string, string> = {}
        for (const entry of list(body.mappings, 200, "mappings")) {
          if (!isGraphId(entry.objectId)) throw new FeatureError("A mapping needs the tenant policy ID.")
          mappings[key(entry.policyKey, "policy")] = entry.objectId
        }
        return { install: recordWorkspaceInstall(deps, sources, tenantId, frameworkId, mappings, actor) }
      }
      throw new FeatureError("Choose an OpenIntuneBaseline deployment or a workspace.")
    },
    releases: ({ tenantId, body, actor }) => checkReleases(deps, sources, tenantId, idOf(body, "installId"), actor),
    compare: async ({ tenantId, body, actor }) => {
      const commit = optionalText(body, "commit", 40)
      const upgrade = await compareUpgrade(deps, sources, tenantId, idOf(body, "installId"), commit, actor)
      return { upgrade, comparison: plain(getComparison(deps, tenantId, upgrade.comparisonId)) }
    },
    resolve: ({ tenantId, body, actor }) => {
      const settings = list(body.settings, 5000, "resolutions").map((entry) => {
        if (entry.choice !== "local" && entry.choice !== "upstream") throw new FeatureError("A resolution is local or upstream.")
        return { policyKey: key(entry.policyKey, "policy"), settingKey: key(entry.settingKey, "setting"), choice: entry.choice as Choice }
      })
      const policies = list(body.policies, 500, "policy choices").map((entry) => {
        if (!["include", "skip", "keep", "delete"].includes(String(entry.choice))) throw new FeatureError("Invalid policy choice")
        return { policyKey: key(entry.policyKey, "policy"), choice: entry.choice as UpgradePolicy["choice"] }
      })
      return { upgrade: resolveUpgrade(deps, tenantId, idOf(body), { settings, policies }, actor) }
    },
    "create-change-set": async ({ tenantId, body, actor }) => {
      if (body.policyKeys !== undefined && body.policyKeys !== null && (!Array.isArray(body.policyKeys) || body.policyKeys.length > 200)) throw new FeatureError("Invalid policies")
      const policyKeys = Array.isArray(body.policyKeys) ? body.policyKeys.map((entry) => key(entry, "policy")) : null
      const result = await createUpgradeChangeSet(deps, tenantId, idOf(body), { policyKeys, title: optionalText(body, "title", 200), ticket: optionalText(body, "ticket", 200) }, actor)
      return result
    },
    discard: ({ tenantId, body, actor }) => {
      getUpgrade(deps, tenantId, idOf(body))
      return { upgrade: discardUpgrade(deps, tenantId, idOf(body), text(body, "reason", 500), actor) }
    },
  })
}

/** Nothing runs in the background; release checks happen when the admin asks. */
export function start(_deps: FeatureDeps): () => void {
  return () => undefined
}

/** Pending upgrades, unresolved conflicts, unknown provenance and unfinished upgrades. */
export const signals: SignalProvider = (deps, tenantId) => baselineSignals(deps, tenantId)
