import type { Item, Json } from "../../../shared/intune/registry"
import { canonicalJson, hashOf, REDACTED } from "../change-sets/model"
import { dataType, normalize, policyMatchKey, settingsByKey } from "../baseline-upgrades/merge"

/**
 * Pure model of golden standards (#148): immutable standard versions with a typed parameter
 * schema, customer overlays kept apart from the base, the effective customer configuration,
 * version diffs, parameter migration and deviation assessment. No Electron, no network.
 */

export type ParameterType = "string" | "integer" | "choice" | "reference"

export interface ParameterDef {
  /** Stable identifier, lowercase letters, digits and hyphens. */
  name: string
  label: string
  type: ParameterType
  required: boolean
  /** Default value; never for references, which only exist in a customer tenant. */
  default: string | number | null
  min: number | null
  max: number | null
  maxLength: number | null
  /** Allowed choice values (full choice setting value IDs). */
  options: string[]
  /** The name this parameter had in the previous version, so customer values carry over. */
  renamedFrom: string | null
  description: string
}

export interface StandardSetting {
  /** Root setting instance as the standard defines it, without IDs. */
  instance: Item
  /** A parameter whose value is written into this setting for each customer. */
  parameter: string | null
}

export interface StandardPolicy {
  key: string
  name: string
  description: string
  platforms: string
  technologies: string
  templateId: string
  settings: StandardSetting[]
}

/** One immutable standard version, stored in the shared scope; no tenant evidence. */
export interface StandardVersion {
  title: string
  status: "published"
  summary: string
  standardKey: string
  version: number
  previousVersionId: string | null
  source: { type: "oib" | "manual"; reference: string; commit: string | null; platform: string | null }
  changeNotes: string
  parameters: ParameterDef[]
  policies: StandardPolicy[]
  contentHash: string
}

export interface OverlaySetting {
  policyKey: string
  instance: Item
}

export interface OverlayException {
  policyKey: string
  settingDefinitionId: string
  reason: string
  approver: string
  expiresAt: string
  status: "approved" | "revoked"
}

export interface Overlay {
  settings: OverlaySetting[]
  removals: Array<{ policyKey: string; settingDefinitionId: string }>
  /** Approved deviations the live tenant may have; they never change the effective configuration. */
  exceptions: OverlayException[]
}

export interface EffectivePolicy {
  key: string
  name: string
  snapshot: Item
}

export interface Problem {
  kind: "conflict" | "blocker" | "warning"
  policyKey: string | null
  settingKey: string | null
  message: string
}

const NAME = /^[a-z][a-z0-9-]{0,39}$/
const isObject = (value: unknown): value is Item => !!value && typeof value === "object" && !Array.isArray(value)
const GUID = /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i

// ---------------------------------------------------------------------------------------------
// Parameters

/** Validates a parameter schema from untrusted input. Throws with a plain message. */
export function parseParameterDefs(value: unknown): ParameterDef[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 50) throw new Error("A standard has at most 50 parameters.")
  const names = new Set<string>()
  return value.map((entry, index) => {
    if (!isObject(entry)) throw new Error(`Parameter ${index + 1} is invalid.`)
    const name = String(entry.name ?? "")
    if (!NAME.test(name)) throw new Error(`Parameter ${index + 1}: the name uses lowercase letters, digits and hyphens.`)
    if (names.has(name)) throw new Error(`Parameter ${name} is defined twice.`)
    names.add(name)
    const type = entry.type
    if (type !== "string" && type !== "integer" && type !== "choice" && type !== "reference") throw new Error(`Parameter ${name}: unknown type.`)
    const number = (key: string): number | null => (entry[key] === undefined || entry[key] === null ? null : Number.isSafeInteger(entry[key]) ? (entry[key] as number) : (() => { throw new Error(`Parameter ${name}: ${key} must be a whole number.`) })())
    const options = Array.isArray(entry.options) ? entry.options.map(String).slice(0, 100) : []
    if (type === "choice" && !options.length) throw new Error(`Parameter ${name}: a choice needs options.`)
    const renamedFrom = entry.renamedFrom === undefined || entry.renamedFrom === null || entry.renamedFrom === "" ? null : String(entry.renamedFrom)
    if (renamedFrom !== null && !NAME.test(renamedFrom)) throw new Error(`Parameter ${name}: invalid previous name.`)
    const def: ParameterDef = {
      name,
      label: String(entry.label ?? name).slice(0, 200),
      type,
      // A reference has no default and only exists in a customer tenant, so it is always required.
      required: type === "reference" || entry.required !== false,
      default: null,
      min: number("min"),
      max: number("max"),
      maxLength: number("maxLength"),
      options,
      renamedFrom,
      description: String(entry.description ?? "").slice(0, 1000),
    }
    if (entry.default !== undefined && entry.default !== null && entry.default !== "") {
      if (type === "reference") throw new Error(`Parameter ${name}: a reference exists only in a customer tenant and has no default.`)
      const checked = checkValue(def, entry.default)
      if (typeof checked === "string" && checked.startsWith("!")) throw new Error(`Parameter ${name}: the default is invalid (${checked.slice(1)}).`)
      def.default = checked
    }
    return def
  })
}

/** A checked value, or a string starting with "!" that explains why the value is invalid. */
function checkValue(def: ParameterDef, value: unknown): string | number | `!${string}` {
  if (def.type === "integer") {
    const number = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value
    if (!Number.isSafeInteger(number)) return "!a whole number is required"
    if (def.min !== null && (number as number) < def.min) return `!at least ${def.min}`
    if (def.max !== null && (number as number) > def.max) return `!at most ${def.max}`
    return number as number
  }
  if (typeof value !== "string" || !value.trim()) return "!a value is required"
  if (def.type === "choice") return def.options.includes(value) ? value : "!not one of the allowed options"
  if (def.type === "reference") return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : "!the ID of a reusable setting in this tenant is required"
  if (value.length > (def.maxLength ?? 1000)) return `!at most ${def.maxLength ?? 1000} characters`
  return value
}

/**
 * Customer parameter values checked against the schema. Missing values fall back to defaults;
 * a required parameter without value or default is a blocker. Unknown names are reported.
 */
export function resolveParameters(defs: ParameterDef[], values: Record<string, unknown>): { values: Record<string, string | number>; problems: Problem[] } {
  const result: Record<string, string | number> = {}
  const problems: Problem[] = []
  for (const def of defs) {
    const raw = values[def.name]
    if (raw === undefined || raw === null || raw === "") {
      if (def.default !== null) result[def.name] = def.default
      else if (def.required) problems.push({ kind: "blocker", policyKey: null, settingKey: null, message: `Parameter "${def.label}" needs a value for this customer.` })
      continue
    }
    const checked = checkValue(def, raw)
    if (typeof checked === "string" && checked.startsWith("!")) problems.push({ kind: "blocker", policyKey: null, settingKey: null, message: `Parameter "${def.label}": ${checked.slice(1)}.` })
    else result[def.name] = checked
  }
  for (const name of Object.keys(values)) {
    if (!defs.some((def) => def.name === name)) problems.push({ kind: "warning", policyKey: null, settingKey: null, message: `Parameter "${name}" is not part of this standard version; its value is ignored.` })
  }
  return { values: result, problems }
}

/**
 * Carries customer values to a new version: renamed parameters keep their value under the new
 * name, removed ones are listed (their value no longer applies), new required ones without a
 * default are listed as missing. Nothing is dropped silently.
 */
export function migrateParameters(previous: ParameterDef[], next: ParameterDef[], values: Record<string, unknown>): { values: Record<string, unknown>; notes: Array<{ kind: "renamed" | "removed" | "missing" | "defaulted"; name: string; message: string }> } {
  const migrated: Record<string, unknown> = {}
  const notes: Array<{ kind: "renamed" | "removed" | "missing" | "defaulted"; name: string; message: string }> = []
  const used = new Set<string>()
  for (const def of next) {
    if (values[def.name] !== undefined && previous.some((old) => old.name === def.name)) {
      migrated[def.name] = values[def.name]
      used.add(def.name)
    } else if (def.renamedFrom && values[def.renamedFrom] !== undefined) {
      migrated[def.name] = values[def.renamedFrom]
      used.add(def.renamedFrom)
      notes.push({ kind: "renamed", name: def.name, message: `Parameter "${def.renamedFrom}" is now "${def.name}"; the customer value is carried over.` })
    } else if (!previous.some((old) => old.name === def.name || old.name === def.renamedFrom)) {
      if (def.default !== null) notes.push({ kind: "defaulted", name: def.name, message: `New parameter "${def.name}" uses its default ${String(def.default)}.` })
      else if (def.required) notes.push({ kind: "missing", name: def.name, message: `New parameter "${def.name}" needs a value for this customer.` })
    }
  }
  for (const old of previous) {
    if (!used.has(old.name) && !next.some((def) => def.name === old.name) && values[old.name] !== undefined) notes.push({ kind: "removed", name: old.name, message: `Parameter "${old.name}" was removed; the customer value ${JSON.stringify(values[old.name])} no longer applies.` })
  }
  return { values: migrated, notes }
}

// ---------------------------------------------------------------------------------------------
// Standard content

const valueTypeOf = (instance: Item): string => dataType(instance) ?? ""

/** Why a setting cannot be part of a reusable standard as is, or null. */
function unsharable(instance: Item, rootReferenceBound: boolean): string | null {
  const text = JSON.stringify(instance)
  if (/SecretSettingValue/i.test(text) || text.includes(REDACTED)) return "holds a secret value; secrets are never stored in a standard"
  // Only the root value of a simple setting bound to a reference parameter may be a reference;
  // any other reference (nested, in a collection or unbound) would keep a tenant object ID.
  const references = countReferences(instance)
  if (references > (rootReferenceBound ? 1 : 0)) return "references a tenant-specific object; bind the setting's own value to a reference parameter (nested and collection references are not supported)"
  return null
}

function countReferences(value: Json | undefined): number {
  if (Array.isArray(value)) return value.reduce<number>((sum, entry) => sum + countReferences(entry), 0)
  if (!isObject(value)) return 0
  const own = typeof value["@odata.type"] === "string" && /ReferenceSettingValue$/i.test(value["@odata.type"]) ? 1 : 0
  return own + Object.values(value).reduce<number>((sum, entry) => sum + countReferences(entry ?? null), 0)
}

/** Whether an instance is a simple setting whose own value is a reference. */
const isRootReference = (instance: Item): boolean => String(instance["@odata.type"] ?? "").endsWith("SimpleSettingInstance") && isObject(instance.simpleSettingValue) && /ReferenceSettingValue$/i.test(String(instance.simpleSettingValue["@odata.type"] ?? ""))

/**
 * Builds standard policies from Settings Catalog exports, keeping only reusable content: IDs,
 * assignments, scope tags, timestamps and template display fields are dropped. Secret values are
 * refused; tenant references are allowed only when bound to a reference parameter, and every
 * binding must fit the setting's type.
 */
export function buildStandardPolicies(input: unknown, defs: ParameterDef[], bindings: Array<{ policyKey: string; settingDefinitionId: string; parameter: string }>): StandardPolicy[] {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error("A standard holds between 1 and 100 Settings Catalog policies.")
  const policies = input.map((entry, index): StandardPolicy => {
    if (!isObject(entry) || typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 300 || !Array.isArray(entry.settings) || !entry.settings.length || entry.settings.length > 1000) throw new Error(`Policy ${index + 1}: expected a Settings Catalog policy with a name and settings.`)
    const key = policyMatchKey(entry.name)
    const settings: StandardSetting[] = []
    for (const [instanceKey, instance] of settingsByKey(entry)) {
      if (instanceKey.startsWith("#")) throw new Error(`Policy "${entry.name}": a setting has no definition ID.`)
      if (instanceKey.includes("#")) throw new Error(`Policy "${entry.name}": setting ${instanceKey.split("#")[0]} appears twice.`)
      const binding = bindings.find((candidate) => candidate.policyKey === key && candidate.settingDefinitionId === instanceKey)
      const boundDef = binding ? defs.find((candidate) => candidate.name === binding.parameter) : undefined
      const rootReferenceBound = boundDef?.type === "reference" && isRootReference(instance)
      const reason = unsharable(instance, rootReferenceBound)
      if (reason) throw new Error(`Policy "${entry.name}": setting ${instanceKey} ${reason}.`)
      const stored = normalize(instance) as Item
      // A bound reference keeps no value: the source tenant's object ID is tenant evidence.
      if (rootReferenceBound && isObject(stored.simpleSettingValue)) stored.simpleSettingValue.value = ""
      settings.push({ instance: stored, parameter: binding?.parameter ?? null })
    }
    const template = isObject(entry.templateReference) && typeof entry.templateReference.templateId === "string" ? entry.templateReference.templateId : ""
    return { key, name: entry.name.trim(), description: typeof entry.description === "string" ? entry.description.slice(0, 2000) : "", platforms: String(entry.platforms ?? ""), technologies: String(entry.technologies ?? ""), templateId: template, settings }
  })
  const keys = new Set<string>()
  for (const policy of policies) {
    if (!policy.platforms || !policy.technologies) throw new Error(`Policy "${policy.name}": platforms and technologies are required.`)
    if (keys.has(policy.key)) throw new Error(`Two policies share the name "${policy.name}".`)
    keys.add(policy.key)
  }
  for (const binding of bindings) {
    const def = defs.find((candidate) => candidate.name === binding.parameter)
    const setting = policies.find((policy) => policy.key === binding.policyKey)?.settings.find((entry) => entry.instance.settingDefinitionId === binding.settingDefinitionId)
    if (!def) throw new Error(`A binding names the unknown parameter "${binding.parameter}".`)
    if (!setting) throw new Error(`Parameter "${binding.parameter}" is bound to a setting that is not in the standard.`)
    const kind = valueTypeOf(setting.instance)
    // Parameters bind to the root value of a simple or choice setting; collections are not bindable.
    const fits = def.type === "choice" ? kind === "ChoiceSettingInstance" : def.type === "integer" ? kind === "SimpleSettingInstance/IntegerSettingValue" : def.type === "reference" ? kind === "SimpleSettingInstance/ReferenceSettingValue" : kind === "SimpleSettingInstance/StringSettingValue"
    if (!fits) throw new Error(`Parameter "${binding.parameter}" (${def.type}) does not fit setting ${binding.settingDefinitionId} (${kind}).`)
  }
  for (const def of defs) {
    if (!policies.some((policy) => policy.settings.some((setting) => setting.parameter === def.name))) throw new Error(`Parameter "${def.name}" is not bound to any setting.`)
  }
  return policies
}

/** Content hash of a version: what decides the configuration, not titles or notes. */
export function versionContentHash(version: Pick<StandardVersion, "parameters" | "policies">): string {
  return hashOf({ parameters: version.parameters, policies: version.policies })
}

/** Whether shared content accidentally carries a given tenant's identifiers. */
export function containsTenantEvidence(content: unknown, identifiers: string[]): boolean {
  const text = JSON.stringify(content).toLowerCase()
  return identifiers.some((id) => id && text.includes(id.toLowerCase()))
}

/** Whether a string looks like an object ID, to find unbound tenant identifiers. */
export const looksLikeObjectId = (value: string): boolean => GUID.test(value)

// ---------------------------------------------------------------------------------------------
// Effective configuration

function bind(instance: Item, def: ParameterDef, value: string | number): Item {
  const copy = structuredClone(instance)
  if (def.type === "choice" && isObject(copy.choiceSettingValue)) copy.choiceSettingValue.value = String(value)
  else if (isObject(copy.simpleSettingValue)) copy.simpleSettingValue.value = def.type === "integer" ? Number(value) : String(value)
  return copy
}

/**
 * The configuration one customer receives: the base version, parameter values written into
 * their bound settings, then the overlay (settings replaced or added, settings removed). Reports
 * conflicts (overlay on a parameter-bound setting, duplicate or contradicting overlay entries,
 * changed data types, exception and overlay on the same setting) and blockers (unknown policies,
 * secrets, missing parameter values). The base version is never modified.
 */
export function effectiveConfiguration(version: Pick<StandardVersion, "parameters" | "policies">, parameterValues: Record<string, unknown>, overlay: Overlay): { policies: EffectivePolicy[]; problems: Problem[]; parameters: Record<string, string | number> } {
  const { values, problems } = resolveParameters(version.parameters, parameterValues)
  const seen = new Set<string>()
  for (const entry of overlay.settings) {
    const settingKey = typeof entry.instance.settingDefinitionId === "string" ? entry.instance.settingDefinitionId : ""
    const policy = version.policies.find((candidate) => candidate.key === entry.policyKey)
    if (!policy) {
      problems.push({ kind: "blocker", policyKey: entry.policyKey, settingKey, message: `The overlay names a policy that is not in this standard version (${entry.policyKey}).` })
      continue
    }
    if (!settingKey) problems.push({ kind: "blocker", policyKey: entry.policyKey, settingKey: null, message: "An overlay setting has no definition ID." })
    const id = `${entry.policyKey}|${settingKey}`
    if (seen.has(id)) problems.push({ kind: "conflict", policyKey: entry.policyKey, settingKey, message: `The overlay sets ${settingKey} more than once.` })
    seen.add(id)
    const base = policy.settings.find((setting) => setting.instance.settingDefinitionId === settingKey)
    if (base?.parameter) problems.push({ kind: "conflict", policyKey: entry.policyKey, settingKey, message: `${settingKey} is set by the parameter "${base.parameter}"; change the parameter instead of overlaying the setting.` })
    if (base && valueTypeOf(base.instance) !== valueTypeOf(entry.instance)) problems.push({ kind: "conflict", policyKey: entry.policyKey, settingKey, message: `The overlay changes the data type of ${settingKey} from ${valueTypeOf(base.instance)} to ${valueTypeOf(entry.instance)}.` })
    if (/SecretSettingValue/i.test(JSON.stringify(entry.instance))) problems.push({ kind: "blocker", policyKey: entry.policyKey, settingKey, message: `The overlay value of ${settingKey} is a secret; secrets are set in Intune directly.` })
    if (overlay.removals.some((removal) => removal.policyKey === entry.policyKey && removal.settingDefinitionId === settingKey)) problems.push({ kind: "conflict", policyKey: entry.policyKey, settingKey, message: `The overlay both sets and removes ${settingKey}.` })
    if (overlay.exceptions.some((exception) => exception.status === "approved" && exception.policyKey === entry.policyKey && exception.settingDefinitionId === settingKey)) problems.push({ kind: "conflict", policyKey: entry.policyKey, settingKey, message: `${settingKey} has both an overlay value and an approved exception; keep one.` })
  }
  for (const removal of overlay.removals) {
    const policy = version.policies.find((candidate) => candidate.key === removal.policyKey)
    if (!policy) problems.push({ kind: "blocker", policyKey: removal.policyKey, settingKey: removal.settingDefinitionId, message: `The overlay removes a setting of a policy that is not in this standard version (${removal.policyKey}).` })
    else if (!policy.settings.some((setting) => setting.instance.settingDefinitionId === removal.settingDefinitionId)) problems.push({ kind: "warning", policyKey: removal.policyKey, settingKey: removal.settingDefinitionId, message: `The overlay removes ${removal.settingDefinitionId}, which this version no longer has.` })
    else if (policy.settings.find((setting) => setting.instance.settingDefinitionId === removal.settingDefinitionId)?.parameter) problems.push({ kind: "conflict", policyKey: removal.policyKey, settingKey: removal.settingDefinitionId, message: `${removal.settingDefinitionId} is set by a parameter and cannot be removed by the overlay.` })
  }
  for (const exception of overlay.exceptions) {
    if (!version.policies.some((policy) => policy.key === exception.policyKey)) problems.push({ kind: "warning", policyKey: exception.policyKey, settingKey: exception.settingDefinitionId, message: `The exception for ${exception.settingDefinitionId} names a policy that is not in this standard version.` })
  }
  const policies = version.policies.map((policy): EffectivePolicy => {
    const settings: Item[] = []
    for (const setting of policy.settings) {
      const key = String(setting.instance.settingDefinitionId)
      if (overlay.removals.some((removal) => removal.policyKey === policy.key && removal.settingDefinitionId === key) && !setting.parameter) continue
      const override = overlay.settings.find((entry) => entry.policyKey === policy.key && entry.instance.settingDefinitionId === key)
      const def = setting.parameter ? version.parameters.find((candidate) => candidate.name === setting.parameter) : undefined
      const value = setting.parameter ? values[setting.parameter] : undefined
      const instance = override && !setting.parameter ? override.instance : def && value !== undefined ? bind(setting.instance, def, value) : setting.instance
      settings.push({ settingInstance: structuredClone(instance) })
    }
    for (const entry of overlay.settings) {
      if (entry.policyKey === policy.key && !policy.settings.some((setting) => setting.instance.settingDefinitionId === entry.instance.settingDefinitionId)) settings.push({ settingInstance: structuredClone(entry.instance) })
    }
    return { key: policy.key, name: policy.name, snapshot: { name: policy.name, description: policy.description, platforms: policy.platforms, technologies: policy.technologies, roleScopeTagIds: ["0"], templateReference: { templateId: policy.templateId }, settings } }
  })
  return { policies, problems, parameters: values }
}

/** Reference values (reusable setting IDs) an effective configuration relies on. */
export function referencedIds(policies: EffectivePolicy[]): string[] {
  const ids = new Set<string>()
  const walk = (value: Json): void => {
    if (Array.isArray(value)) return value.forEach(walk)
    if (!isObject(value)) return
    if (typeof value["@odata.type"] === "string" && /ReferenceSettingValue$/.test(value["@odata.type"]) && typeof value.value === "string") ids.add(value.value.toLowerCase())
    for (const entry of Object.values(value)) walk(entry ?? null)
  }
  for (const policy of policies) walk(policy.snapshot)
  return [...ids]
}

// ---------------------------------------------------------------------------------------------
// Version diff and assessment

export interface VersionDiffEntry {
  policyKey: string
  settingKey: string | null
  change: "added" | "removed" | "changed"
  message: string
}

/** What changed between two versions of a standard: policies, settings and parameters. */
export function diffVersions(from: Pick<StandardVersion, "parameters" | "policies">, to: Pick<StandardVersion, "parameters" | "policies">): VersionDiffEntry[] {
  const entries: VersionDiffEntry[] = []
  for (const policy of to.policies) {
    const old = from.policies.find((candidate) => candidate.key === policy.key)
    if (!old) {
      entries.push({ policyKey: policy.key, settingKey: null, change: "added", message: `Policy "${policy.name}" added.` })
      continue
    }
    for (const setting of policy.settings) {
      const key = String(setting.instance.settingDefinitionId)
      const previous = old.settings.find((candidate) => candidate.instance.settingDefinitionId === key)
      if (!previous) entries.push({ policyKey: policy.key, settingKey: key, change: "added", message: `${key} added.` })
      else if (canonicalJson(previous) !== canonicalJson(setting)) entries.push({ policyKey: policy.key, settingKey: key, change: "changed", message: valueTypeOf(previous.instance) !== valueTypeOf(setting.instance) ? `${key} changed its data type.` : `${key} changed.` })
    }
    for (const setting of old.settings) {
      const key = String(setting.instance.settingDefinitionId)
      if (!policy.settings.some((candidate) => candidate.instance.settingDefinitionId === key)) entries.push({ policyKey: policy.key, settingKey: key, change: "removed", message: `${key} removed.` })
    }
  }
  for (const policy of from.policies) {
    if (!to.policies.some((candidate) => candidate.key === policy.key)) entries.push({ policyKey: policy.key, settingKey: null, change: "removed", message: `Policy "${policy.name}" removed.` })
  }
  for (const def of to.parameters) {
    if (def.renamedFrom && from.parameters.some((old) => old.name === def.renamedFrom)) entries.push({ policyKey: "", settingKey: null, change: "changed", message: `Parameter "${def.renamedFrom}" renamed to "${def.name}".` })
    else if (!from.parameters.some((old) => old.name === def.name)) entries.push({ policyKey: "", settingKey: null, change: "added", message: `Parameter "${def.name}" added.` })
  }
  for (const old of from.parameters) {
    if (!to.parameters.some((def) => def.name === old.name || def.renamedFrom === old.name)) entries.push({ policyKey: "", settingKey: null, change: "removed", message: `Parameter "${old.name}" removed.` })
  }
  return entries
}

export type SettingState = "match" | "differs" | "missing" | "extra" | "excepted"

/**
 * Deviation of one live policy from its effective configuration, per setting. An approved,
 * unexpired exception marks a difference "excepted": still listed, never counted as a match.
 */
export function assessPolicy(effective: Item, live: Item, policyKey: string, exceptions: OverlayException[], now: Date): Array<{ key: string; state: SettingState }> {
  const [wanted, actual] = [settingsByKey(effective), settingsByKey(live)]
  const excepted = (key: string) => exceptions.some((exception) => exception.status === "approved" && exception.policyKey === policyKey && exception.settingDefinitionId === key && Date.parse(exception.expiresAt) > now.getTime())
  const result: Array<{ key: string; state: SettingState }> = []
  for (const [key, instance] of wanted) {
    const found = actual.get(key)
    const state: SettingState = !found ? "missing" : canonicalJson(normalize(found)) === canonicalJson(normalize(instance)) ? "match" : "differs"
    result.push({ key, state: state !== "match" && excepted(key) ? "excepted" : state })
  }
  for (const key of actual.keys()) if (!wanted.has(key)) result.push({ key, state: excepted(key) ? "excepted" : "extra" })
  return result
}
