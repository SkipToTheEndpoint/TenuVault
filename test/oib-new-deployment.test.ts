import { describe, expect, it } from "vitest"
import { policyGate, typeGate } from "../src/shared/oib/licensing"
import type { MatchStatus, OibCatalog, OibComparison, OibPlatform, OibPolicy } from "../src/shared/oib/types"
import { addShown, availableTypes, buildRows, defaultSelection, needsLicensing, NEUTRAL_PROFILE, pruneSelection, rowCounts, rowKey, shownRows } from "../src/renderer/components/oib/NewDeploymentRows"

const policy = (name: string, extra: Partial<OibPolicy> = {}): OibPolicy => ({
  source: `${name}.json`, name, folder: "configurationPolicies", policyType: "SettingsCatalog", previousVersions: [], replacements: [],
  skuRequirements: "", licenseRequirements: "", status: "active", ...extra,
})

function pack(platform: OibPlatform, policies: OibPolicy[], statuses: Record<string, MatchStatus> = {}) {
  const catalog = { platform, commit: "c".repeat(40), reference: `OIB ${platform}`, source: "", license: "", manifest: true, policies, deprecated: [] } as OibCatalog
  const comparison = { tenantId: "t", platform, commit: catalog.commit, reference: catalog.reference, comparedAt: "", tenantPolicyCount: 0, deprecated: [],
    matches: policies.map(p => ({ source: p.source, status: statuses[p.name] ?? "missing", legacy: [] })) } as OibComparison
  return { catalog, comparison }
}

const business = { licensing: "business-premium" as const, defenderAv: false, autopatch: true }

describe("New Deployment rows", () => {
  const windows = pack("windows", [
    policy("Win A"), policy("Win Enterprise", { skuRequirements: "Enterprise" }), policy("Win MDE", { licenseRequirements: "MDE" }),
    policy("Win Ring", { policyType: "UpdatePolicies" }), policy("Win Current"),
  ], { "Win Current": "current" })
  const macos = pack("macos", [policy("Mac A"), policy("Mac MDE", { licenseRequirements: "MDE" }), policy("Mac Compliance", { policyType: "CompliancePolicies" })])
  const byod = pack("byod", [policy("BYOD iOS", { policyType: "AppProtection" })])

  it("asks the licensing questions only for Windows or Windows 365", () => {
    expect(needsLicensing(["macos", "byod"])).toBe(false)
    expect(needsLicensing(["macos", "win365"])).toBe(true)
    expect(needsLicensing(["windows"])).toBe(true)
  })

  it("the neutral profile gates no type and no policy", () => {
    for (const type of ["SettingsCatalog", "EndpointSecurity", "CompliancePolicies", "UpdatePolicies", "DriverUpdateProfiles", "AppProtection"]) expect(typeGate(type, NEUTRAL_PROFILE)).toBeUndefined()
    for (const p of [...windows.catalog.policies, ...macos.catalog.policies]) expect(policyGate(p, NEUTRAL_PROFILE)).toBeUndefined()
  })

  it("applies the Windows answers to Windows policies only", () => {
    const rows = buildRows([windows, macos, byod], availableTypes([windows, macos, byod]), business)
    const gated = rows.filter(r => r.gate).map(r => r.policy.name)
    expect(gated).toEqual(["Win Enterprise", "Win MDE", "Win Ring"])
    expect(rows.find(r => r.policy.name === "Mac MDE")?.gate).toBeUndefined()
  })

  it("counts only the rows the list shows", () => {
    const rows = buildRows([windows, macos], availableTypes([windows, macos]), business)
    expect(rowCounts(rows, false)).toEqual({ available: 5, fresh: 4, inTenant: 1, gated: 3 })
    expect(rowCounts(rows, true)).toEqual({ available: 8, fresh: 7, inTenant: 1, gated: 3 })
    expect(shownRows(rows, false).length).toBe(5)
  })

  it("selects new suitable policies, adds shown rows and drops hidden ones", () => {
    const rows = buildRows([windows, macos], availableTypes([windows, macos]), business)
    const start = defaultSelection(rows)
    expect([...start].sort()).toEqual([rowKey("macos", "Mac A.json"), rowKey("macos", "Mac Compliance.json"), rowKey("macos", "Mac MDE.json"), rowKey("windows", "Win A.json")])
    const searched = shownRows(rows, true, "win")
    const added = addShown(new Set([rowKey("macos", "Mac A.json")]), searched)
    // Adds to the selection and never selects a policy already in the tenant.
    expect(added.has(rowKey("macos", "Mac A.json"))).toBe(true)
    expect(added.has(rowKey("windows", "Win MDE.json"))).toBe(true)
    expect(added.has(rowKey("windows", "Win Current.json"))).toBe(false)
    const pruned = pruneSelection(added, rows, false)
    expect(pruned.has(rowKey("windows", "Win MDE.json"))).toBe(false)
    expect(pruned.has(rowKey("windows", "Win A.json"))).toBe(true)
    expect(pruneSelection(pruned, rows, false)).toBe(pruned)
  })

  it("orders policy types like the type list", () => {
    expect(availableTypes([byod, windows, macos])).toEqual(["SettingsCatalog", "CompliancePolicies", "UpdatePolicies", "AppProtection"])
  })
})
