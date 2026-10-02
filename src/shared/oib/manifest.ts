import { record } from "../frameworks/policies"
import type { OibDeprecated, OibPolicy } from "./types"

const GUID = /^[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}$/i
const OIBID = /OIBID:\s*([0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12})/i

export interface ManifestEntry {
  oibId: string
  name: string
  policyType: string
  status: string
  scope?: string
  addedIn?: string
  previousVersions: string[]
  supersededBy: string[]
  skuRequirements: string
  licenseRequirements: string
}

export interface Manifest {
  version?: string
  entries: ManifestEntry[]
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "")

/** OIBIDs from a manifest field that may be "", a GUID, a list of GUIDs or a list of { oibId }. */
function ids(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,;]+/) : []
  return list
    .map((entry) => (typeof entry === "string" ? entry : record(entry) && typeof entry.oibId === "string" ? entry.oibId : ""))
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => GUID.test(entry))
}

/** Reads PolicyManifest.json (OIB 3.8 and later). Entries without an OIBID or name are left out. */
export function parseManifest(value: unknown): Manifest {
  if (!record(value) || !Array.isArray(value.policies)) throw new Error("PolicyManifest.json has no policy list.")
  const entries = value.policies.slice(0, 2000).filter(record).flatMap((entry): ManifestEntry[] => {
    const oibId = text(entry.oibId).toUpperCase()
    const name = text(entry.name)
    if (!GUID.test(oibId) || !name) return []
    return [{
      oibId, name,
      policyType: text(entry.policyType),
      status: text(entry.status).toLowerCase() || "active",
      scope: text(entry.scope) || undefined,
      addedIn: text(entry.addedIn) || undefined,
      previousVersions: ids(entry.previousVersions),
      supersededBy: ids(entry.supersededBy),
      skuRequirements: text(entry.skuRequirements),
      licenseRequirements: text(entry.licenseRequirements),
    }]
  })
  const version = text(value.oibVersion)
  return { version: version ? `v${version.replace(/^v/i, "")}` : undefined, entries }
}

/** The OIBID OIB 3.8 and later appends to each policy description, uppercased. */
export function extractOibId(description: unknown): string | undefined {
  if (typeof description !== "string") return undefined
  return OIBID.exec(description)?.[1]?.toUpperCase()
}

/** A policy type for packs without a manifest, from the file path and the OIB naming convention. */
export function typeFromPath(path: string, name: string): string {
  const lower = path.toLowerCase()
  if (lower.includes("/compliancepolicies/")) return "CompliancePolicies"
  if (lower.includes("/driverupdateprofiles/")) return "DriverUpdateProfiles"
  if (lower.includes("/updatepolicies/")) return "UpdatePolicies"
  if (lower.includes("/administrativetemplates/")) return "AdminTemplates"
  if (lower.includes("/deviceconfiguration/")) return "DeviceConfiguration"
  if (lower.includes("/appprotection/")) return "AppProtection"
  return / - ES - /.test(name) ? "EndpointSecurity" : "SettingsCatalog"
}

const fileName = (path: string) => (path.split("/").pop() ?? path).replace(/\.json$/i, "").trim().toLowerCase()

/** Joins pack files with their manifest entries (by policy name, then file name). */
export function catalogPolicies(
  items: Array<{ source: string; name: string; folder: string }>,
  manifest: Manifest | null,
): { policies: OibPolicy[]; deprecated: OibDeprecated[] } {
  const byName = new Map<string, ManifestEntry>()
  const byId = new Map<string, ManifestEntry>()
  for (const entry of manifest?.entries ?? []) {
    byName.set(entry.name.toLowerCase(), entry)
    byId.set(entry.oibId, entry)
  }
  const replacements = (entry: ManifestEntry) =>
    entry.supersededBy.flatMap((id) => {
      const replacement = byId.get(id)
      return replacement ? [{ oibId: id, name: replacement.name }] : []
    })
  const policies = items.map((item): OibPolicy => {
    const entry = byName.get(item.name.trim().toLowerCase()) ?? byName.get(fileName(item.source))
    return {
      source: item.source,
      name: item.name,
      folder: item.folder,
      policyType: entry?.policyType || typeFromPath(item.source, item.name),
      oibId: entry?.oibId,
      previousVersions: entry?.previousVersions ?? [],
      replacements: entry ? replacements(entry) : [],
      skuRequirements: entry?.skuRequirements ?? "",
      licenseRequirements: entry?.licenseRequirements ?? "",
      status: entry?.status ?? "active",
      scope: entry?.scope,
    }
  })
  // Retired policies may have no file any more; their entries still identify tenant policies to review.
  const deprecated = (manifest?.entries ?? [])
    .filter((entry) => entry.status === "deprecated")
    .map((entry) => ({ oibId: entry.oibId, name: entry.name, replacements: replacements(entry) }))
  return { policies, deprecated }
}
