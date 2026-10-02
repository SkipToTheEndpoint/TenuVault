import { canonicalJson, hashOf, REDACTED } from "../change-sets/model"
import type { Item, Json } from "../../../shared/intune/registry"

/**
 * Pure three-way comparison of Settings Catalog policies for baseline upgrades (#144), also
 * used by golden standards (#148) to render and compare settings. No Electron, no network.
 *
 * A setting is identified by the settingDefinitionId of its root setting instance. For each
 * setting the installed source (base), the current tenant (local) and the new release
 * (upstream) are compared after normalization (null members, Graph annotations and setting IDs
 * dropped), and the outcome is classified. Nothing is ever merged by guessing: a setting both
 * sides changed differently, a changed data type and every difference without a known base
 * need an explicit resolution.
 */

export type SettingKind =
  /** Same everywhere. */
  | "unchanged"
  /** Only the new release added, removed or changed it; the tenant still has the installed value. */
  | "upstream-added"
  | "upstream-removed"
  | "upstream-changed"
  /** Only the tenant changed it (added, removed or edited); the release did not. Kept as is. */
  | "local-kept"
  /** Both changed it to the same value. */
  | "converged"
  /** Both changed it differently. Needs a resolution. */
  | "conflict"
  /** The release changed the setting's data type. Needs a resolution. */
  | "type-changed"
  /** Secret or tenant-specific reference values; never merged, the tenant value stays. */
  | "unsupported"
  /** The installed source is unknown, so a difference cannot be attributed. Needs a resolution. */
  | "unknown-base"

export type Choice = "local" | "upstream"

export interface SettingDecision {
  key: string
  kind: SettingKind
  needsResolution: boolean
  /** Short previews for review; never secrets (secret values are reported as unsupported). */
  base: string | null
  local: string | null
  upstream: string | null
  note: string | null
}

export interface FieldDecision {
  field: "name" | "description"
  kind: SettingKind
  base: string | null
  local: string | null
  upstream: string | null
}

export interface PolicyComparison {
  /** Settings by key, in upstream order followed by tenant-only settings. */
  settings: SettingDecision[]
  fields: FieldDecision[]
  /** Reasons the whole policy is compared manually only (platform or template changed). */
  blockers: string[]
  counts: Record<SettingKind, number>
}

const PREVIEW = 160
const ODATA_PREFIX = "#microsoft.graph.deviceManagementConfiguration"

const isObject = (value: unknown): value is Item => !!value && typeof value === "object" && !Array.isArray(value)

/** A value without null members, Graph annotations other than @odata.type, or `id`s of setting entries. */
export function normalize(value: Json | undefined): Json {
  if (Array.isArray(value)) return value.map((entry) => normalize(entry))
  if (isObject(value)) {
    const result: Item = {}
    for (const key of Object.keys(value).sort()) {
      const entry = value[key]
      if (entry === null || entry === undefined) continue
      if (key.includes("@odata.") && key !== "@odata.type") continue
      result[key] = normalize(entry)
    }
    return result
  }
  return value ?? null
}

/** The root instances of a policy's settings, keyed by settingDefinitionId; duplicates get a suffix. */
export function settingsByKey(policy: Item | null): Map<string, Item> {
  const result = new Map<string, Item>()
  const settings = policy && Array.isArray(policy.settings) ? (policy.settings as Json[]) : []
  for (const [index, entry] of settings.entries()) {
    const instance = isObject(entry) && isObject(entry.settingInstance) ? entry.settingInstance : null
    const id = instance && typeof instance.settingDefinitionId === "string" && instance.settingDefinitionId ? instance.settingDefinitionId : `#invalid-${index}`
    const key = result.has(id) ? `${id}#${index}` : id
    result.set(key, instance ?? { invalid: true })
  }
  return result
}

/** The data type of a setting: its instance type plus the type of its simple values. */
export function dataType(instance: Item | undefined): string | null {
  if (!instance) return null
  const kind = String(instance["@odata.type"] ?? "").replace(ODATA_PREFIX, "")
  const simple = instance.simpleSettingValue
  const collection = Array.isArray(instance.simpleSettingCollectionValue) ? instance.simpleSettingCollectionValue[0] : undefined
  const valueType = isObject(simple) ? simple["@odata.type"] : isObject(collection) ? collection["@odata.type"] : undefined
  return typeof valueType === "string" ? `${kind}/${valueType.replace(ODATA_PREFIX, "")}` : kind
}

/**
 * Why a setting cannot be merged automatically, or null. Secret values are masked on read and
 * reference values point at objects (reusable settings) that exist per tenant.
 */
export function unsupportedSetting(instance: Item | undefined): string | null {
  if (!instance) return null
  if (instance.invalid === true || typeof instance.settingDefinitionId !== "string") return "The setting has no definition ID."
  const text = JSON.stringify(instance)
  if (/SecretSettingValue/i.test(text) || text.includes(REDACTED)) return "The setting holds a secret value that Intune masks; review it in Intune."
  if (/ReferenceSettingValue/i.test(text)) return "The setting references a tenant-specific object (a reusable setting); review it in Intune."
  return null
}

const same = (a: Item | undefined, b: Item | undefined): boolean => canonicalJson(normalize(a ?? null)) === canonicalJson(normalize(b ?? null))

function preview(instance: Item | undefined): string | null {
  if (!instance) return null
  if (unsupportedSetting(instance)) return "(not shown)"
  const text = canonicalJson(normalize(valueOnly(instance)))
  return text.length > PREVIEW ? `${text.slice(0, PREVIEW)}...` : text
}

/** The value members of an instance, without template references, for previews. */
function valueOnly(instance: Item): Json {
  const { settingInstanceTemplateReference: _t, settingDefinitionId: _d, "@odata.type": _o, ...rest } = instance
  return rest as Item
}

/**
 * Classifies one setting. `base` undefined with `hasBase` false means the installed source is
 * unknown (manual comparison).
 */
export function classifySetting(key: string, base: Item | undefined, local: Item | undefined, upstream: Item | undefined, hasBase: boolean): SettingDecision {
  const decision = (kind: SettingKind, note: string | null = null): SettingDecision => ({
    key,
    kind,
    needsResolution: kind === "conflict" || kind === "type-changed" || kind === "unknown-base",
    base: preview(base),
    local: preview(local),
    upstream: preview(upstream),
    note,
  })
  const unsupported = unsupportedSetting(base) ?? unsupportedSetting(local) ?? unsupportedSetting(upstream)
  if (unsupported) return decision("unsupported", `${unsupported} The tenant value is kept.`)
  if (!hasBase) {
    if (same(local, upstream)) return decision("unchanged")
    return decision("unknown-base", "The installed source is unknown, so this difference cannot be attributed to the tenant or the release.")
  }
  const upstreamChanged = !same(base, upstream)
  const localChanged = !same(base, local)
  if (!upstreamChanged) return decision(localChanged ? "local-kept" : "unchanged")
  const typeChanged = !!base && !!upstream && dataType(base) !== dataType(upstream)
  if (typeChanged) return decision("type-changed", `The release changed the data type from ${dataType(base)} to ${dataType(upstream)}.`)
  if (!localChanged) return decision(!base ? "upstream-added" : !upstream ? "upstream-removed" : "upstream-changed")
  if (same(local, upstream)) return decision("converged")
  return decision("conflict", !local ? "The tenant removed this setting and the release changed it." : !upstream ? "The tenant changed this setting and the release removed it." : "The tenant and the release changed this setting differently.")
}

function classifyField(field: "name" | "description", base: Item | null, local: Item | null, upstream: Item | null, hasBase: boolean): FieldDecision {
  const value = (policy: Item | null) => (policy && typeof policy[field] === "string" ? (policy[field] as string) : null)
  const [b, l, u] = [value(base), value(local), value(upstream)]
  let kind: SettingKind
  if (!hasBase) kind = l === u ? "unchanged" : "local-kept"
  else if (b === u) kind = l === b ? "unchanged" : "local-kept"
  else if (l === b) kind = "upstream-changed"
  else kind = l === u ? "converged" : "local-kept"
  return { field, kind, base: b, local: l, upstream: u }
}

const emptyCounts = (): Record<SettingKind, number> => ({ unchanged: 0, "upstream-added": 0, "upstream-removed": 0, "upstream-changed": 0, "local-kept": 0, converged: 0, conflict: 0, "type-changed": 0, unsupported: 0, "unknown-base": 0 })

const templateOf = (policy: Item | null): string => (policy && isObject(policy.templateReference) && typeof policy.templateReference.templateId === "string" ? policy.templateReference.templateId : "")

/**
 * Compares one policy three ways. Name and description follow the release only when the tenant
 * kept the installed value; otherwise the tenant's text stays. A changed platform, technology or
 * template cannot be merged into the existing policy and blocks it.
 */
export function comparePolicy(base: Item | null, local: Item, upstream: Item): PolicyComparison {
  const hasBase = base !== null
  const blockers: string[] = []
  for (const field of ["platforms", "technologies"] as const) {
    if (String(local[field] ?? "") !== String(upstream[field] ?? "")) blockers.push(`The release changed ${field} from ${String(local[field] ?? "unknown")} to ${String(upstream[field] ?? "unknown")}; Intune cannot change this on an existing policy.`)
  }
  if (templateOf(local) !== templateOf(upstream)) blockers.push("The release uses a different template; Intune cannot change the template of an existing policy.")
  const [b, l, u] = [settingsByKey(base), settingsByKey(local), settingsByKey(upstream)]
  const keys = [...u.keys(), ...[...l.keys(), ...b.keys()].filter((key) => !u.has(key))].filter((key, index, all) => all.indexOf(key) === index)
  const settings = keys.map((key) => classifySetting(key, b.get(key), l.get(key), u.get(key), hasBase))
  const counts = emptyCounts()
  for (const setting of settings) counts[setting.kind] += 1
  return { settings, fields: [classifyField("name", base, local, upstream, hasBase), classifyField("description", base, local, upstream, hasBase)], blockers, counts }
}

/** Settings of a comparison that still need a resolution. */
export function unresolvedKeys(comparison: PolicyComparison, resolutions: Record<string, Choice>): string[] {
  return comparison.settings.filter((setting) => setting.needsResolution && !resolutions[setting.key]).map((setting) => setting.key)
}

/**
 * The merged policy: the tenant's policy (scope tags and every field the release does not own
 * stay) with each setting taken from the side its classification or resolution selects.
 * Assignments are never part of the result; they are left untouched by the change set.
 * Throws when a setting still needs a resolution, so an unresolved conflict never reaches a write.
 */
export function mergePolicy(base: Item | null, local: Item, upstream: Item, resolutions: Record<string, Choice>): Item {
  const comparison = comparePolicy(base, local, upstream)
  if (comparison.blockers.length) throw new Error(comparison.blockers.join(" "))
  const missing = unresolvedKeys(comparison, resolutions)
  if (missing.length) throw new Error(`${missing.length} setting${missing.length === 1 ? "" : "s"} still need a resolution.`)
  const [l, u] = [settingsByKey(local), settingsByKey(upstream)]
  const settings: Item[] = []
  for (const decision of comparison.settings) {
    const upstreamSide = decision.kind === "upstream-added" || decision.kind === "upstream-changed" || decision.kind === "upstream-removed" || decision.kind === "converged" || (decision.needsResolution && resolutions[decision.key] === "upstream")
    const chosen = upstreamSide ? u.get(decision.key) : l.get(decision.key)
    if (chosen) settings.push({ settingInstance: structuredClone(chosen) })
  }
  const { assignments: _assignments, settings: _settings, ...rest } = structuredClone(local)
  const merged: Item = { ...rest, settings }
  for (const field of comparison.fields) {
    if (field.kind === "upstream-changed" || field.kind === "converged") merged[field.field] = field.upstream
  }
  return merged
}

/**
 * The tenant's deviations from a reference configuration: settings whose normalized value
 * differs, as key and value hash. Its hash identifies a customization version, so a later
 * upgrade can tell whether the customizations it recorded are still the ones in the tenant.
 */
export function deviations(reference: Item | null, actual: Item | null): Array<{ key: string; hash: string | null }> {
  const [r, a] = [settingsByKey(reference), settingsByKey(actual)]
  const keys = [...new Set([...r.keys(), ...a.keys()])].sort()
  return keys.filter((key) => !same(r.get(key), a.get(key))).map((key) => ({ key, hash: a.has(key) ? hashOf(normalize(a.get(key))) : null }))
}

/** Normalized hash of a policy's settings and names, to detect a changed tenant between review and change set. */
export function policyHash(policy: Item | null): string {
  if (!policy) return "missing"
  return hashOf({ name: policy.name ?? null, description: policy.description ?? null, settings: [...settingsByKey(policy).entries()].map(([key, value]) => [key, normalize(value)]) })
}

/**
 * The key a baseline policy is matched by across releases: OIB names end in a version such as
 * " - v3.8", which changes with every release, so it is left out.
 */
export function policyMatchKey(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]*v\d+(?:\.\d+){0,3}$/i, "").trim()
}

/** One policy of a baseline set: its match key (see policyMatchKey), name and snapshot. */
export interface SetPolicy {
  key: string
  name: string
  snapshot: Item
}

export interface SetComparisonEntry {
  key: string
  name: string
  /**
   * matched: in local and upstream (compared per setting); added: only upstream; removed: in
   * base and local but no longer upstream; local-missing: in base but not local.
   */
  kind: "matched" | "added" | "removed" | "local-missing"
  comparison: PolicyComparison | null
}

/**
 * Three-way comparison of whole baseline sets, pure: `base` is the installed or customized
 * source (null when unknown, which makes every difference need a resolution), `local` the
 * current policies (tenant, backup snapshot or an edited custom baseline), `upstream` the new
 * release. Policies are matched by key. Reused by baseline upgrades and by callers that keep
 * their own baselines (custom OIB baselines, company baselines from snapshots).
 */
export function comparePolicySets(base: SetPolicy[] | null, local: SetPolicy[], upstream: SetPolicy[]): SetComparisonEntry[] {
  const byKey = (set: SetPolicy[] | null) => new Map((set ?? []).map((policy) => [policy.key, policy]))
  const [b, l, u] = [byKey(base), byKey(local), byKey(upstream)]
  const entries: SetComparisonEntry[] = []
  for (const [key, policy] of l) {
    const release = u.get(key)
    if (release) entries.push({ key, name: policy.name, kind: "matched", comparison: comparePolicy(base ? b.get(key)?.snapshot ?? null : null, policy.snapshot, release.snapshot) })
    else if (!base || b.has(key)) entries.push({ key, name: policy.name, kind: "removed", comparison: null })
  }
  for (const [key, policy] of b) if (!l.has(key)) entries.push({ key, name: policy.name, kind: "local-missing", comparison: null })
  for (const [key, policy] of u) if (!l.has(key) && !b.has(key)) entries.push({ key, name: policy.name, kind: "added", comparison: null })
  return entries
}
