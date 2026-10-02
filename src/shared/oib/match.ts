import type { DeprecatedMatch, OibDeprecated, OibPolicy, PolicyMatch, TenantPolicy } from "./types"

/** The version OIB puts at the end of a policy name ("... - v3.8"). */
export function policyVersion(name: string): string | undefined {
  return /\bv(\d+(?:\.\d+)*)\s*$/i.exec(name.trim())?.[1]
}

/** A policy name without its version, for matching policies of different OIB versions. */
export function baseName(name: string): string {
  return name.trim().replace(/\s*-\s*v\d+(?:\.\d+)*\s*$/i, "").trim().toLowerCase()
}

export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number)
  const right = b.split(".").map(Number)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0)
    if (difference) return Math.sign(difference)
  }
  return 0
}

/** A tenant policy's version against the pack's; undefined when either name has no version. */
function versionOrder(entry: TenantPolicy, version: string | undefined): number | undefined {
  const own = policyVersion(entry.name)
  return own && version ? compareVersions(own, version) : undefined
}

/** The one candidate with the highest version, or undefined when that version is shared or a name has none. */
function newest(candidates: TenantPolicy[]): TenantPolicy | undefined {
  if (candidates.length === 1) return candidates[0]
  const versions = candidates.map((entry) => policyVersion(entry.name))
  if (versions.some((version) => !version)) return undefined
  const sorted = candidates.map((entry, index) => ({ entry, version: versions[index]! })).sort((a, b) => compareVersions(b.version, a.version))
  return compareVersions(sorted[0]!.version, sorted[1]!.version) > 0 ? sorted[0]!.entry : undefined
}

/** The one candidate at the pack's version, if exactly one is. */
function atVersion(candidates: TenantPolicy[], version: string | undefined): TenantPolicy | undefined {
  const same = candidates.filter((entry) => versionOrder(entry, version) === 0)
  return same.length === 1 ? same[0] : undefined
}

/**
 * Matches pack policies with tenant policies: first by the OIBID in the description (current or a
 * previous version), then by name without version for policies deployed before OIB 3.8. Of several
 * copies, the one at the pack's version is matched (the newest for previous OIBIDs) and the others
 * are listed as legacy copies to review; only copies that cannot be told apart are a duplicate,
 * which is never matched automatically. A copy newer than the pack (when comparing against an older
 * release) is reported as newer, so an update never targets an older copy next to it.
 */
export function compareToTenant(
  policies: OibPolicy[],
  deprecated: OibDeprecated[],
  tenant: TenantPolicy[],
): { matches: PolicyMatch[]; deprecated: DeprecatedMatch[] } {
  // A tenant policy that carries a known OIBID belongs to that policy; names cannot claim it.
  const claimed = new Set<string>([
    ...policies.flatMap((policy) => [policy.oibId, ...policy.previousVersions].filter((id): id is string => !!id)),
    ...deprecated.map((entry) => entry.oibId),
  ])
  const matches = policies.map((policy): PolicyMatch => {
    const oibVersion = policyVersion(policy.name)
    const matched = (status: PolicyMatch["status"], method: "oibid" | "name", match: TenantPolicy, all: TenantPolicy[]): PolicyMatch =>
      ({ source: policy.source, status, method, tenant: match, legacy: all.filter((entry) => entry !== match), oibVersion, tenantVersion: policyVersion(match.name) })
    const duplicate = (method: "oibid" | "name", candidates: TenantPolicy[]): PolicyMatch => ({ source: policy.source, status: "duplicate", method, matches: candidates, legacy: [] })
    const current = policy.oibId ? tenant.filter((entry) => entry.oibId === policy.oibId) : []
    const previous = policy.oibId ? tenant.filter((entry) => entry.oibId && policy.previousVersions.includes(entry.oibId)) : []
    const base = baseName(policy.name)
    const named = tenant.filter((entry) => entry.folder === policy.folder && !(entry.oibId && claimed.has(entry.oibId)) && baseName(entry.name) === base)
    const all = [...current, ...previous, ...named]
    const higher = named.filter((entry) => (versionOrder(entry, oibVersion) ?? 0) > 0)
    if (higher.length) {
      const top = newest(higher)
      return top ? matched("newer", "name", top, all) : duplicate("name", higher)
    }
    if (current.length) {
      const match = current.length === 1 ? current[0] : atVersion(current, oibVersion)
      return match ? matched("current", "oibid", match, all) : duplicate("oibid", current)
    }
    // A copy at the pack's version found by name (deployed by an older app, or created alongside) is the current one.
    const same = atVersion(named, oibVersion)
    if (previous.length) {
      if (same) return matched("current", "name", same, all)
      const match = newest(previous)
      return match ? matched("outdated", "oibid", match, all) : duplicate("oibid", previous)
    }
    if (!named.length) return { source: policy.source, status: "missing", legacy: [], oibVersion }
    if (named.length === 1) return matched((versionOrder(named[0]!, oibVersion) ?? 0) < 0 ? "outdated" : "current", "name", named[0]!, all)
    return same ? matched("current", "name", same, all) : duplicate("name", named)
  })
  const retired = deprecated.flatMap((entry) =>
    tenant
      .filter((policy) => policy.oibId === entry.oibId)
      .map((policy) => ({
        oibId: entry.oibId,
        name: entry.name,
        tenant: policy,
        replacements: entry.replacements.map((replacement) => ({ ...replacement, deployed: tenant.some((other) => other.oibId === replacement.oibId) })),
      })),
  )
  return { matches, deprecated: retired }
}
