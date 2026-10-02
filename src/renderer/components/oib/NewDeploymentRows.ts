import { policyGate, POLICY_TYPES, type TenantProfile } from "../../../shared/oib/licensing"
import type { MatchStatus, OibCatalog, OibComparison, OibPlatform, OibPolicy } from "../../../shared/oib/types"

/** The licensing, Defender and Autopatch questions are about Windows; they gate only these platforms. */
export const LICENSED_PLATFORMS: OibPlatform[] = ["windows", "win365"]
export const needsLicensing = (platforms: OibPlatform[]) => platforms.some(p => LICENSED_PLATFORMS.includes(p))
/** Gates nothing: every type and policy passes typeGate and policyGate with it. */
export const NEUTRAL_PROFILE: TenantProfile = { licensing: "enterprise", defenderAv: true, autopatch: false }

export interface NewRow {
  key: string
  platform: OibPlatform
  policy: OibPolicy
  /** The match status when a tenant policy matched; such rows cannot be selected here. */
  inTenant?: MatchStatus
  /** Why the policy does not suit the tenant, from the licensing answers. */
  gate?: string
}

export const rowKey = (platform: OibPlatform, source: string) => `${platform}\n${source}`

/** Why a policy already in the tenant cannot be deployed as new. */
export const inTenantReason = (status: MatchStatus) => status === "current" ? "Already in the tenant and up to date."
  : status === "outdated" ? "An older version is in the tenant: update it with Existing Deployment."
  : status === "newer" ? "A newer version is in the tenant."
  : "Several tenant policies match it: review them with Existing Deployment."

const typeOrder = Object.keys(POLICY_TYPES)

/** Policy types of the loaded packs, in the usual order. */
export const availableTypes = (loaded: Array<{ catalog: OibCatalog }>) => [...new Set(loaded.flatMap(l => l.catalog.policies.map(p => p.policyType)))]
  .sort((a, b) => (typeOrder.indexOf(a) + 1 || 99) - (typeOrder.indexOf(b) + 1 || 99))

export function buildRows(loaded: Array<{ catalog: OibCatalog; comparison: OibComparison }>, types: string[], profile: TenantProfile): NewRow[] {
  return loaded.flatMap(({ catalog, comparison }) => {
    const matches = new Map(comparison.matches.map(m => [m.source, m]))
    const gated = LICENSED_PLATFORMS.includes(catalog.platform)
    return catalog.policies.filter(p => types.includes(p.policyType)).map(policy => {
      const match = matches.get(policy.source)
      return { key: rowKey(catalog.platform, policy.source), platform: catalog.platform, policy,
        inTenant: match && match.status !== "missing" ? match.status : undefined, gate: gated ? policyGate(policy, profile) : undefined }
    })
  })
}

/** Rows the list shows: unsuitable rows only when asked for, then the search. */
export const shownRows = (rows: NewRow[], showGated: boolean, search = "") => {
  const query = search.trim().toLowerCase()
  return rows.filter(r => (showGated || !r.gate) && (!query || r.policy.name.toLowerCase().includes(query)))
}

export const selectable = (row: NewRow) => !row.inTenant

/** Counts of the rows in the list (before the search): hidden unsuitable rows are not counted. */
export function rowCounts(rows: NewRow[], showGated: boolean) {
  const listed = shownRows(rows, showGated)
  return { available: listed.length, fresh: listed.filter(selectable).length, inTenant: listed.filter(r => r.inTenant).length, gated: rows.filter(r => r.gate).length }
}

/** New policies that suit the tenant: the starting selection. */
export const defaultSelection = (rows: NewRow[]) => new Set(rows.filter(r => selectable(r) && !r.gate).map(r => r.key))

/** Adds the selectable rows shown to the selection. */
export const addShown = (selected: Set<string>, shown: NewRow[]) => new Set([...selected, ...shown.filter(selectable).map(r => r.key)])

/** Keeps only selected rows that exist, can be selected and are not hidden as unsuitable. */
export function pruneSelection(selected: Set<string>, rows: NewRow[], showGated: boolean) {
  const allowed = new Set(rows.filter(r => selectable(r) && (showGated || !r.gate)).map(r => r.key))
  const next = new Set([...selected].filter(k => allowed.has(k)))
  return next.size === selected.size ? selected : next
}
