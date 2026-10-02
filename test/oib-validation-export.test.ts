import { expect, it } from "vitest"
import { validationJson } from "../src/shared/oib/validation-export"
import type { ValidationRun } from "../src/shared/oib/types"

it("round-trips current, repeated and saved validation evidence without losing provenance or unknowns", () => {
  const run: ValidationRun = {
    runId: "first", tenantId: "tenant-a", platform: "windows", commit: "a".repeat(40),
    reference: "OIB Windows", validatedAt: "2026-09-30T10:00:00Z", validationVersion: 1,
    results: [{ source: "WINDOWS/test.json", name: "Policy <test>", folder: "ConfigurationPolicies", tenantPolicyId: "p1", tenantPolicyName: "Production", status: "drifted", expectedSettings: 650,
      result: { totalOib: 650, totalTenant: 0, matched: 0, missing: 650, different: 0, extra: 0, compliant: false, mismatches: [], oibOnly: [{ settingDefinitionId: "test", label: "test", oibValue: "value\nwith quotes \"" }], tenantOnly: [] } }],
  }
  const failed: ValidationRun = { ...run, runId: "retry", platform: "macos", validatedAt: "2026-09-30T11:00:00Z", results: [{ ...run.results[0]!, result: undefined, status: "error", error: "Permission denied" }] }
  const exportData = JSON.parse(validationJson([run, failed], "tenant-a", "Tenant A", "2026-09-30T12:00:00Z"))
  expect(exportData).toMatchObject({ schemaVersion: 1, kind: "oib-policy-validation", tenantId: "tenant-a", tenantName: "Tenant A" })
  expect(exportData.runs).toEqual(JSON.parse(JSON.stringify([run, failed])))
  expect(exportData.runs[0].results[0].result.missing).toBe(650)
  expect(exportData.runs[1].results[0]).not.toHaveProperty("result")
})

it("excludes foreign tenant evidence and leaves the supplied saved runs unchanged", () => {
  const runs = [{ tenantId: "TENANT-A", runId: "own" }, { tenantId: "tenant-b", runId: "foreign" }] as ValidationRun[]
  const original = JSON.stringify(runs)
  expect(JSON.parse(validationJson(runs, "tenant-a", "A", "now")).runs).toEqual([runs[0]])
  expect(JSON.stringify(runs)).toBe(original)
  expect(JSON.parse(validationJson([], "tenant-a", "A", "now")).runs).toEqual([])
})
