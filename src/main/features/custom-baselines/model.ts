import type { Item, Json } from "../../../shared/intune/registry"
import type { DetailedExportData } from "../../../shared/compliance/input"
import type { Finding, LandscapePolicy } from "../../../shared/frameworks/policies"
import { hashOf, REDACTED } from "../change-sets/model"
import { policyMatchKey, settingsByKey } from "../baseline-upgrades/merge"

/**
 * Pure model of custom baselines: the organization's own Settings Catalog baselines, created
 * from an OpenIntuneBaseline release or a tenant backup, edited in immutable versions and
 * deployed through the change-set engine. No Electron, no network: every rule here is unit
 * tested directly. The service (service.ts) adds records, sources and the tenant.
 */

export const FOLDER = "ConfigurationPolicies"
/** Most policies one baseline holds; OIB platform packs stay well below this. */
export const MAX_POLICIES = 200
/** Most versions kept per baseline; each version is a frozen copy of every policy. */
export const MAX_VERSIONS = 50
const MAX_STRING = 4096
const MASKED = "****"

/** A setting whose value cannot be deployed from the baseline as stored. */
export interface NonPortable {
  /** Root settingDefinitionId (the key settingsByKey uses). */
  settingKey: string
  reason: "secret" | "reference"
  note: string
}

/** One Settings Catalog policy of a custom baseline. */
export interface CustomPolicy {
  /** `ConfigurationPolicies:<policyMatchKey(name)>`; matches the policy across releases and tenants. */
  key: string
  name: string
  /** Settings Catalog configuration without IDs, assignments or scope tags. */
  snapshot: Item
  nonPortable: NonPortable[]
}

const isObject = (value: unknown): value is Item => !!value && typeof value === "object" && !Array.isArray(value)

export const keyOf = (name: string): string => `${FOLDER}:${policyMatchKey(name)}`

const TOP_LEVEL_DROPPED = new Set(["id", "createdDateTime", "lastModifiedDateTime", "assignments", "settingCount", "isAssigned", "creationSource", "priorityMetaData", "roleScopeTagIds", "@odata.type", "@odata.context", "version"])

/** Graph annotations, export action links and null members out; @odata.type inside settings stays. */
function cleanValue(value: Json): Json {
  if (Array.isArray(value)) return value.map(cleanValue)
  if (!isObject(value)) return value
  const result: Item = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined) continue
    if (key.startsWith("#")) continue
    if (key.includes("@odata.") && key !== "@odata.type") continue
    if (key === "auditRuleInformation" || key === "settingDefinitions") continue
    result[key] = cleanValue(entry)
  }
  return result
}

/**
 * A snapshot as a baseline stores it: IDs, timestamps, assignments, scope tags and Graph
 * annotations removed (scope tags only exist in their tenant; deployments use the target's).
 * Secret values Intune returns (masked or as an encrypted token) and plain "****" masks are
 * replaced with the redaction marker, which the change-set engine refuses to write, and the
 * setting is reported as not portable. Reference values point at tenant-specific reusable
 * settings and are reported as not portable too.
 */
export function stripForBaseline(snapshot: Item): { snapshot: Item; nonPortable: NonPortable[] } {
  const copy: Item = {}
  for (const [key, value] of Object.entries(structuredClone(snapshot))) if (!TOP_LEVEL_DROPPED.has(key)) copy[key] = value
  const cleaned = cleanValue(copy) as Item
  const settings = Array.isArray(cleaned.settings) ? (cleaned.settings as Json[]) : []
  cleaned.settings = settings.map((entry) => (isObject(entry) && isObject(entry.settingInstance) ? { settingInstance: entry.settingInstance } : entry))
  const nonPortable: NonPortable[] = []
  for (const [settingKey, instance] of settingsByKey(cleaned)) {
    let secret = false
    let reference = false
    const walk = (value: Json): void => {
      if (Array.isArray(value)) return value.forEach(walk)
      if (!isObject(value)) return
      const kind = typeof value["@odata.type"] === "string" ? value["@odata.type"] : ""
      if (/SecretSettingValue$/i.test(kind)) {
        secret = true
        if ("value" in value) value.value = REDACTED
      } else if (/ReferenceSettingValue$/i.test(kind)) reference = true
      else if (value.value === MASKED) {
        secret = true
        value.value = REDACTED
      }
      for (const key of Object.keys(value)) walk(value[key] ?? null)
    }
    walk(instance)
    if (secret) nonPortable.push({ settingKey, reason: "secret", note: "Holds a secret value Intune masks. It was not stored and cannot be deployed; remove the setting or configure it in Intune." })
    else if (reference) nonPortable.push({ settingKey, reason: "reference", note: "References a tenant-specific reusable setting. Remove the setting before deploying, or configure it in Intune." })
  }
  return { snapshot: cleaned, nonPortable }
}

/** Builds a baseline policy from a source snapshot. */
export function customPolicy(name: string, snapshot: Item): CustomPolicy {
  const stripped = stripForBaseline({ ...snapshot, name })
  return { key: keyOf(name), name, snapshot: stripped.snapshot, nonPortable: stripped.nonPortable }
}

/** Hash of a version's content, independent of key order. */
export function contentHash(policies: CustomPolicy[]): string {
  return hashOf(policies.map((policy) => ({ key: policy.key, name: policy.name, snapshot: policy.snapshot })))
}

// ---------------------------------------------------------------------------------------------
// Readable settings

const PREFIXES = ["device_vendor_msft_policy_config_", "user_vendor_msft_policy_config_", "device_vendor_msft_", "user_vendor_msft_", "vendor_msft_", "com.apple."]

/**
 * A readable name derived from a settingDefinitionId. The packs carry no setting display
 * names and TenuVault does not look them up online, so the name is the definition ID without
 * its CSP prefix, with separators spaced out. The full ID is always shown next to it.
 */
export function settingLabel(definitionId: string, parentId?: string): string {
  let id = definitionId
  if (parentId && id.startsWith(`${parentId}_`)) id = id.slice(parentId.length + 1)
  else for (const prefix of PREFIXES) if (id.toLowerCase().startsWith(prefix)) { id = id.slice(prefix.length); break }
  return id.replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim() || definitionId
}

export type LeafKind = "boolean-choice" | "choice" | "string" | "integer" | "secret" | "reference" | "read-only"

/** One configured value inside a setting, addressed by its path from the root instance. */
export interface SettingLeaf {
  path: string
  definitionId: string
  label: string
  kind: LeafKind
  /** Readable value: the choice option without the definition prefix, the string or integer. */
  value: string | number | null
  /** Raw choice value, for choices. */
  raw: string | null
  /** For boolean-like choices: the two raw options. */
  options: string[] | null
}

export interface SettingView {
  key: string
  definitionId: string
  label: string
  leaves: SettingLeaf[]
  nonPortable: NonPortable | null
}

const BOOLEAN_SUFFIXES: Array<[string, string]> = [["_true", "_false"], ["_1", "_0"]]

function booleanOptions(definitionId: string, value: string): string[] | null {
  // Only exactly "<id>_true|_false|_1|_0": an option such as "<id>_level_1" is not a boolean.
  for (const [a, b] of BOOLEAN_SUFFIXES) if (value === `${definitionId}${a}` || value === `${definitionId}${b}`) return [`${definitionId}${a}`, `${definitionId}${b}`]
  return null
}

function leavesOf(instance: Item, path: string[], parentId: string | undefined, out: SettingLeaf[]): void {
  const definitionId = typeof instance.settingDefinitionId === "string" ? instance.settingDefinitionId : ""
  const label = settingLabel(definitionId, parentId)
  const base = { path: path.join("/"), definitionId, label }
  const choice = isObject(instance.choiceSettingValue) ? instance.choiceSettingValue : null
  const simple = isObject(instance.simpleSettingValue) ? instance.simpleSettingValue : null
  if (choice) {
    const raw = typeof choice.value === "string" ? choice.value : null
    const options = raw ? booleanOptions(definitionId, raw) : null
    out.push({ ...base, kind: options ? "boolean-choice" : raw ? "choice" : "read-only", value: raw ? (raw.startsWith(`${definitionId}_`) ? raw.slice(definitionId.length + 1) : raw) : null, raw, options })
    const children = Array.isArray(choice.children) ? choice.children : []
    children.forEach((child, index) => isObject(child) && leavesOf(child, [...path, "choiceSettingValue", "children", String(index)], definitionId, out))
    return
  }
  if (simple) {
    const type = String(simple["@odata.type"] ?? "")
    const secret = /SecretSettingValue$/i.test(type) || simple.value === REDACTED
    const kind: LeafKind = secret ? "secret" : /ReferenceSettingValue$/i.test(type) ? "reference" : /IntegerSettingValue$/i.test(type) ? "integer" : /StringSettingValue$/i.test(type) ? "string" : "read-only"
    const value = secret ? null : typeof simple.value === "string" || typeof simple.value === "number" ? simple.value : null
    out.push({ ...base, kind, value, raw: null, options: null })
    return
  }
  const groups = Array.isArray(instance.groupSettingCollectionValue) ? instance.groupSettingCollectionValue : isObject(instance.groupSettingValue) ? [instance.groupSettingValue] : null
  if (groups) {
    const field = Array.isArray(instance.groupSettingCollectionValue) ? "groupSettingCollectionValue" : "groupSettingValue"
    groups.forEach((group, groupIndex) => {
      const children = isObject(group) && Array.isArray(group.children) ? group.children : []
      const prefix = field === "groupSettingValue" ? [...path, field, "children"] : [...path, field, String(groupIndex), "children"]
      children.forEach((child, index) => isObject(child) && leavesOf(child, [...prefix, String(index)], definitionId, out))
    })
    return
  }
  // Collections of simple values or choices and unknown shapes are shown, not edited.
  out.push({ ...base, kind: "read-only", value: null, raw: null, options: null })
}

/** The settings of a policy for the editor, with every configured value and its kind. */
export function settingViews(policy: CustomPolicy): SettingView[] {
  return [...settingsByKey(policy.snapshot)].map(([key, instance]) => {
    const leaves: SettingLeaf[] = []
    leavesOf(instance, [], undefined, leaves)
    const definitionId = typeof instance.settingDefinitionId === "string" ? instance.settingDefinitionId : key
    return { key, definitionId, label: settingLabel(definitionId), leaves, nonPortable: policy.nonPortable.find((entry) => entry.settingKey === key) ?? null }
  })
}

// ---------------------------------------------------------------------------------------------
// Edits

export type Edit =
  | { type: "set"; policyKey: string; settingKey: string; path: string; value: string | number }
  | { type: "remove-setting"; policyKey: string; settingKey: string }
  | { type: "remove-policy"; policyKey: string }

export class EditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EditError"
  }
}

function navigate(instance: Item, path: string): Item {
  if (!path) return instance
  let current: Json = instance
  for (const segment of path.split("/")) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) current = current[Number(segment)] ?? null
    else if (isObject(current) && Object.prototype.hasOwnProperty.call(current, segment)) current = current[segment] ?? null
    else throw new EditError("The edited value does not exist in this setting.")
  }
  if (!isObject(current)) throw new EditError("The edited value does not exist in this setting.")
  return current
}

/** Validates one value for a leaf kind and returns what is stored. Throws EditError. */
export function validatedValue(leaf: SettingLeaf, value: string | number): string | number {
  switch (leaf.kind) {
    case "boolean-choice": {
      if (typeof value !== "string" || !leaf.options!.includes(value)) throw new EditError(`${leaf.label}: choose one of the two options.`)
      return value
    }
    case "choice": {
      const raw = typeof value === "string" && !value.startsWith(`${leaf.definitionId}_`) ? `${leaf.definitionId}_${value}` : value
      if (typeof raw !== "string" || raw.length > 400 || !/^[A-Za-z0-9_.{}~-]+$/.test(raw.slice(leaf.definitionId.length + 1)) || raw.length <= leaf.definitionId.length + 1) throw new EditError(`${leaf.label}: a choice value is the option name after the setting ID (letters, digits, _ . - { } ~).`)
      return raw
    }
    case "integer": {
      const number = typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : value
      if (typeof number !== "number" || !Number.isSafeInteger(number)) throw new EditError(`${leaf.label}: enter a whole number.`)
      return number
    }
    case "string": {
      if (typeof value !== "string" || value.length > MAX_STRING) throw new EditError(`${leaf.label}: enter text of at most ${MAX_STRING} characters.`)
      if (value.includes(REDACTED) || value.includes(MASKED)) throw new EditError(`${leaf.label}: masked values cannot be stored.`)
      return value
    }
    default:
      throw new EditError(`${leaf.label}: ${leaf.kind === "secret" ? "secret values are never stored in a baseline; configure them in Intune" : leaf.kind === "reference" ? "tenant-specific references cannot be edited here" : "this value cannot be edited here"}.`)
  }
}

/**
 * Applies edits to a copy of a version's policies. Only choice, string and integer values are
 * edited; secrets and references never are. A policy keeps at least one setting (remove the
 * policy instead), and the baseline keeps at least one policy.
 */
export function applyEdits(policies: CustomPolicy[], edits: Edit[]): CustomPolicy[] {
  let result = structuredClone(policies)
  for (const edit of edits) {
    const policy = result.find((entry) => entry.key === edit.policyKey)
    if (!policy) throw new EditError("An edit names a policy that is not in this version.")
    if (edit.type === "remove-policy") {
      result = result.filter((entry) => entry.key !== edit.policyKey)
      if (!result.length) throw new EditError("A baseline keeps at least one policy.")
      continue
    }
    const settings = Array.isArray(policy.snapshot.settings) ? (policy.snapshot.settings as Item[]) : []
    const keys = [...settingsByKey(policy.snapshot).keys()]
    const index = keys.indexOf(edit.settingKey)
    if (index < 0) throw new EditError(`"${policy.name}" has no setting ${edit.settingKey}.`)
    if (edit.type === "remove-setting") {
      if (settings.length <= 1) throw new EditError(`"${policy.name}" keeps at least one setting. Remove the policy instead.`)
      policy.snapshot.settings = settings.filter((_, position) => position !== index)
      policy.nonPortable = policy.nonPortable.filter((entry) => entry.settingKey !== edit.settingKey)
      continue
    }
    const root = settings[index]?.settingInstance
    if (!isObject(root)) throw new EditError("The edited setting is invalid.")
    const view = settingViews(policy).find((entry) => entry.key === edit.settingKey)
    const leaf = view?.leaves.find((entry) => entry.path === edit.path)
    if (!leaf) throw new EditError("The edited value does not exist in this setting.")
    const stored = validatedValue(leaf, edit.value)
    const target = navigate(root, edit.path)
    if (leaf.kind === "boolean-choice" || leaf.kind === "choice") (target.choiceSettingValue as Item).value = stored
    else (target.simpleSettingValue as Item).value = stored
  }
  return result
}

// ---------------------------------------------------------------------------------------------
// Deployment planning

/** Why a baseline policy cannot be written into an existing tenant policy, or null. */
export function updateBlocker(baseline: Item, live: Item): string | null {
  for (const field of ["platforms", "technologies"] as const) {
    if (String(baseline[field] ?? "") !== String(live[field] ?? "")) return `The tenant policy has ${field} ${String(live[field] ?? "unknown")}, the baseline ${String(baseline[field] ?? "unknown")}; Intune cannot change this on an existing policy.`
  }
  const template = (policy: Item) => (isObject(policy.templateReference) && typeof policy.templateReference.templateId === "string" ? policy.templateReference.templateId : "")
  if (template(baseline) !== template(live)) return "The tenant policy uses a different template; Intune cannot change the template of an existing policy."
  return null
}

/**
 * The configuration written for a baseline policy. Created policies get the Default scope
 * tag; an updated policy keeps the target's scope tags. Assignments are never part of it.
 */
export function proposedBody(policy: CustomPolicy, live: Item | null): Item {
  const tags = live && Array.isArray(live.roleScopeTagIds) && live.roleScopeTagIds.length ? structuredClone(live.roleScopeTagIds) : ["0"]
  const { assignments: _assignments, ...body } = structuredClone(policy.snapshot)
  return { ...body, name: policy.name, roleScopeTagIds: tags }
}

// ---------------------------------------------------------------------------------------------
// Framework comparisons without a tenant

/** A baseline's policies as the "tenant" side of a pack assessment. */
export function baselineLandscape(policies: CustomPolicy[]): LandscapePolicy[] {
  return policies.map((policy) => ({
    id: `baseline:${policy.key}`,
    name: policy.name,
    platforms: String(policy.snapshot.platforms ?? ""),
    technologies: String(policy.snapshot.technologies ?? ""),
    description: typeof policy.snapshot.description === "string" ? policy.snapshot.description : "",
    settings: (Array.isArray(policy.snapshot.settings) ? (policy.snapshot.settings as Item[]) : []).filter((entry) => isObject(entry.settingInstance)).map((entry) => ({ settingInstance: entry.settingInstance as Item })),
  }))
}

/**
 * Pack findings whose baseline value is a masked secret cannot be decided: they become
 * Review instead of Different, so an unknown value is never reported as a mismatch.
 */
export function maskUnknownFindings(findings: Finding[]): Finding[] {
  return findings.map((finding) => (finding.status === "Different" && JSON.stringify(finding.observed).includes(REDACTED) ? { ...finding, status: "Review" as const } : finding))
}

/** Every evidence family a baseline cannot provide: only Settings Catalog policies are in a baseline. */
export const BASELINE_SKIPPED_FAMILIES = ["deviceConfigurations", "administrativeTemplates", "compliancePolicies", "securityBaselines", "appProtectionPolicies", "windowsUpdatePolicies", "conditionalAccessPolicies", "scripts", "appConfigurations", "enrollmentConfigurations"]

/**
 * Native framework evidence built from a baseline version instead of a tenant read. Only the
 * Settings Catalog family is present; every other family is marked as not collected, so the
 * engine reports what depends on it as unable to check, never as missing. Policies carry no
 * assignments, so assignment state is unknown and no control is reported as enforced. Secret
 * values are left out, which the engine treats as present but unreadable.
 */
export function baselineEvidence(policies: CustomPolicy[], collectedAt: string): DetailedExportData {
  const settingsCatalog = policies.map((policy, index) => {
    const snapshot = structuredClone(policy.snapshot)
    const strip = (value: Json): void => {
      if (Array.isArray(value)) return value.forEach(strip)
      if (!isObject(value)) return
      if (value.value === REDACTED) delete value.value
      for (const key of Object.keys(value)) strip(value[key] ?? null)
    }
    strip(snapshot)
    return { ...snapshot, id: `baseline-${index + 1}`, name: policy.name, "@odata.type": "#microsoft.graph.deviceManagementConfigurationPolicy" }
  })
  return {
    collectionStartedAt: collectedAt,
    collectedAt,
    settingsCatalog,
    deviceConfigurations: [],
    administrativeTemplates: [],
    compliancePolicies: [],
    securityBaselines: [],
    appProtectionPolicies: [],
    windowsUpdatePolicies: [],
    conditionalAccessPolicies: [],
    scripts: { windows: [], macOS: [] },
    collectionSkippedFamilies: [...BASELINE_SKIPPED_FAMILIES],
    fetchErrors: [],
  }
}

/** The label every framework comparison of a baseline carries. */
export function comparisonLabel(name: string, version: number): string {
  return `Compared with baseline ${name} v${version}, not with the live tenant.`
}
