import type { NativeAssessment } from "../src/shared/compliance/native"
import type { CapabilityResult, CompliancePlatform, TechnicalCheck } from "../src/shared/compliance/types"
import type { FeatureDeps } from "../src/main/features/deps"

type CheckSpec = "matches" | "different" | "missing" | "unknown" | "outside"

export interface RunSpec {
  runId: string
  tenantId: string
  frameworkId?: string
  at?: string
  version?: string
  ruleset?: string
  platforms?: CompliancePlatform[]
  maturity?: 1 | 2 | 3
  incomplete?: boolean
  /** capability id -> checks */
  caps?: Record<string, CheckSpec[]>
  platformOf?: Record<string, CompliancePlatform>
}

function check(spec: CheckSpec, index: number, capability: string): TechnicalCheck {
  const base = { settingId: `${capability}.setting${index}`, expectedValue: "true", actualValue: spec === "different" ? "false" : null, policyId: `policy-${capability}-${index}`, policyName: `Policy ${index}`, assignment: { state: "assigned" as const, targets: [], exclusions: [], filters: [], coverage: "unverified" as const } }
  if (spec === "unknown") return { ...base, assessmentStatus: "unableToCheck", result: null }
  if (spec === "outside") return { ...base, assessmentStatus: "outsideScope", result: null }
  return { ...base, assessmentStatus: "checked", result: spec }
}

/** A saved native comparison with just the fields the scores and plan read. */
export function makeRun(spec: RunSpec): NativeAssessment {
  const frameworkId = spec.frameworkId ?? "nist-csf"
  const caps = spec.caps ?? { cap1: ["matches"] }
  const capabilities: CapabilityResult[] = Object.entries(caps).map(([id, checks]) => ({
    capability: { id, platform: spec.platformOf?.[id] ?? "windows", name: `Capability ${id}`, description: "", signals: [] },
    status: "enforced",
    evidence: [],
    limitations: [],
    checks: checks.map((item, index) => check(item, index, id)),
  }))
  return {
    schemaVersion: 1,
    runId: spec.runId,
    tenantId: spec.tenantId.toLowerCase(),
    frameworkId,
    sourceCommit: "x",
    snapshotSha256: `snap-${spec.runId}`,
    rulesetSha256: spec.ruleset ?? "ruleset-1",
    licenseNotice: "",
    assessment: {
      generatedAt: spec.at ?? "2026-09-29T10:00:00Z",
      disclaimer: "",
      capabilities,
      frameworks: [{
        framework: { id: "nist", name: "NIST CSF 2.0", version: spec.version ?? "2.0" },
        controls: Object.keys(caps).map((id) => ({ control: { id: `CTRL-${id}`, title: `Control for ${id}`, summary: "", evidenceStrength: "direct" }, capabilityIds: [id], enforcedCapabilityIds: [], status: "noEvidence", unassessedAspects: [], excludedCapabilityIds: [] })),
        summary: { totalControls: 0, withEvidence: 0, partial: 0, withoutEvidence: 0, notApplicable: 0, notAssessed: 0, conflicting: 0, applicableControls: 0 },
      }],
      scope: { platforms: spec.platforms ?? ["windows", "tenant"], essentialEightMaturityLevel: spec.maturity ?? 1, defStanRiskLevel: 1 },
      collectionCoverage: spec.incomplete ? [{ family: "settingsCatalog", collectedPolicies: 1, recognizedPolicies: 1, unsupportedPolicies: 0, status: "incomplete", errors: ["403"] }] : [{ family: "settingsCatalog", collectedPolicies: 1, recognizedPolicies: 1, unsupportedPolicies: 0, status: "complete", errors: [] }],
      provenance: { rulesetVersion: spec.ruleset === "ruleset-2" ? "2026.10" : "2026.09", collectedAt: spec.at ?? "2026-09-29T10:00:00Z", deviceState: "notCollected", effectiveAccess: "unverified" },
    },
  }
}

/**
 * A fake of the app's /api/frameworks native-history action: saved runs per tenant and
 * framework, and tenants whose reads are denied. Records every call for isolation checks.
 */
export function fakeFrameworksApi(saved: Record<string, NativeAssessment[]>, denied: string[] = []) {
  const calls: Array<{ tenantId: string; body: Record<string, unknown> }> = []
  const api: FeatureDeps["api"] = async (path, tenantId, body = {}) => {
    calls.push({ tenantId, body })
    if (path === "/api/oib" && body.action === "oib-validations") return denied.includes(tenantId.toLowerCase()) ? Response.json({ error: "This tenant is not licensed." }, { status: 403 }) : Response.json({ runs: [] })
    if (path !== "/api/frameworks" || body.action !== "native-history") return Response.json({ error: "unexpected" }, { status: 500 })
    if (denied.includes(tenantId.toLowerCase())) return Response.json({ error: "This tenant is not licensed." }, { status: 403 })
    return Response.json({ history: saved[`${tenantId.toLowerCase()}:${String(body.frameworkId)}`] ?? [], persistent: true })
  }
  return { api, calls }
}
