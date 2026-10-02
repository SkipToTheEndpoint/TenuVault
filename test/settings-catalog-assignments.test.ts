import { describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { typeForFolder, type Item } from "../src/shared/intune/registry"
import { assignmentsUnread, detailPath, readObject, withoutUnreadAssignments, type GraphReader } from "../src/shared/intune/read"
import { comparableSnapshot } from "../src/shared/intune/compare"
import { compareBackups } from "../src/shared/intune/backup-changes"
import { compareObjects } from "../src/portal/app/api/detect-drifts/route"
import { Restorer, type GraphCall } from "../src/portal/lib/policies/graph-restore"

/**
 * Recorded with Lokka in the lab tenant (IDs redacted, settings shortened): a Settings Catalog policy with
 * one assignment. The single object read with $expand=settings,assignments answers `assignments: []`,
 * while {id}/assignments returns the assignment.
 */
const POLICY = "00000000-0000-0000-0000-0000000000a1"
const SETTING = {
  id: "0",
  settingInstance: {
    "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance",
    settingDefinitionId: "device_vendor_msft_policy_privilegemanagement_elevationrules_{elevationrulename}_filename",
    auditRuleInformation: null,
    settingInstanceTemplateReference: null,
    simpleSettingValue: { "@odata.type": "#microsoft.graph.deviceManagementConfigurationStringSettingValue", value: "7zip.exe", settingValueTemplateReference: null },
  },
}
const DETAIL = {
  "@odata.context": "https://graph.microsoft.com/beta/$metadata#deviceManagement/configurationPolicies(settings(),assignments())/$entity",
  createdDateTime: "2024-05-15T12:19:19.1939038Z",
  creationSource: null,
  description: "",
  lastModifiedDateTime: "2024-07-31T08:53:10.4862151Z",
  name: "7Zip - Support Approved",
  platforms: "windows10",
  priorityMetaData: null,
  roleScopeTagIds: ["0"],
  settingCount: 1,
  technologies: "endpointPrivilegeManagement",
  id: POLICY,
  templateReference: { templateId: "cff02aad-51b1-498d-83ad-81161a393f56_1", templateFamily: "endpointSecurityEndpointPrivilegeManagement", templateDisplayName: "Elevation rules policy", templateDisplayVersion: "Version 1" },
  "settings@odata.context": `https://graph.microsoft.com/beta/$metadata#deviceManagement/configurationPolicies('${POLICY}')/settings`,
  settings: [SETTING],
  "assignments@odata.context": `https://graph.microsoft.com/beta/$metadata#deviceManagement/configurationPolicies('${POLICY}')/assignments`,
  assignments: [],
}
const ASSIGNMENT = {
  id: `${POLICY}_adadadad-808e-44e2-905a-0b7873a8a531`,
  source: "direct",
  sourceId: POLICY,
  target: { "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget", deviceAndAppManagementAssignmentFilterId: null, deviceAndAppManagementAssignmentFilterType: "none" },
}
const ASSIGNMENTS = { "@odata.context": `https://graph.microsoft.com/beta/$metadata#deviceManagement/configurationPolicies('${POLICY}')/assignments`, value: [ASSIGNMENT] }

const type = typeForFolder("ConfigurationPolicies")!
/** The object as Graph returns it without $expand=assignments. */
const content = (value: Item): Item => {
  const { assignments: _a, "assignments@odata.context": _c, ...rest } = structuredClone(value)
  return rest
}
const hash = (value: Item) => createHash("sha256").update(JSON.stringify(comparableSnapshot(value))).digest("base64").slice(0, 22)

/** Answers like Graph: an expanded assignments list is always empty on the single object read. */
function recordedGraph(): GraphReader & { requests: string[] } {
  const requests: string[] = []
  const detail = (path: string): Item =>
    path.includes("assignments") ? { ...content(DETAIL), assignments: [], "assignments@odata.context": DETAIL["assignments@odata.context"] } : content(DETAIL)
  return {
    requests,
    get: async (path) => {
      requests.push(path)
      return detail(path)
    },
    list: async (path) => {
      requests.push(path)
      if (path === `deviceManagement/configurationPolicies/${POLICY}/assignments`) return structuredClone(ASSIGNMENTS.value)
      throw new Error(`unexpected ${path}`)
    },
  }
}

describe("Settings Catalog assignments in single reads", () => {
  it("reads assignments from {id}/assignments, not from the empty $expand", async () => {
    const graph = recordedGraph()
    const snapshot = await readObject(type, POLICY, graph)

    expect(detailPath(type, POLICY)).toBe(`deviceManagement/configurationPolicies/${POLICY}?$expand=settings`)
    expect(graph.requests).toEqual([detailPath(type, POLICY), `deviceManagement/configurationPolicies/${POLICY}/assignments`])
    expect(snapshot.assignments).toEqual([ASSIGNMENT])
    expect(snapshot.settings).toEqual([SETTING])
    expect(snapshot).not.toHaveProperty(["assignments@odata.context"])
    expect(assignmentsUnread(type, snapshot)).toBe(false)
  })

  it("still pages large settings collections", async () => {
    const second = { ...SETTING, id: "1" }
    const graph: GraphReader = {
      get: async () => ({ ...content(DETAIL), "settings@odata.nextLink": "https://graph.microsoft.com/beta/next" }),
      list: vi.fn(async (path: string) => (path.endsWith("/assignments") ? [ASSIGNMENT] : [second])),
    }
    const snapshot = await readObject(type, POLICY, graph)
    expect(snapshot.settings).toEqual([SETTING, second])
    expect(snapshot.assignments).toEqual([ASSIGNMENT])
    expect(snapshot).not.toHaveProperty(["settings@odata.nextLink"])
  })

  it("reads settings catalog compliance policy assignments the same way", () => {
    const compliance = typeForFolder("ComplianceSettingsPolicies")!
    expect(compliance.expand).toBe("settings")
    expect(compliance.extras?.map((extra) => extra.path("x"))).toContain("deviceManagement/compliancePolicies/x/assignments")
  })
})

describe("backups from versions that could not read the assignments", () => {
  // What the released version stored: the expanded, empty list and its annotation.
  const { "@odata.context": _context, ...legacy } = structuredClone(DETAIL) as Item
  const current: Item = { ...legacy, assignments: [ASSIGNMENT] }
  delete current["assignments@odata.context"]

  it("recognises the legacy empty list, and only for affected types", () => {
    expect(assignmentsUnread(type, legacy)).toBe(true)
    expect(assignmentsUnread(type, current)).toBe(false)
    expect(assignmentsUnread(type, { ...legacy, assignments: [ASSIGNMENT] })).toBe(false)
    expect(assignmentsUnread(typeForFolder("DeviceConfigurations"), legacy)).toBe(false)
  })

  it("does not list reading the assignments as a change between backups", () => {
    const older = { Items: { [`ConfigurationPolicies/${POLICY}`]: { file: "7Zip.json", hash: hash(legacy) } } }
    const newer = { Items: { [`ConfigurationPolicies/${POLICY}`]: { file: "7Zip.json", hash: hash(current), hashWithEmptyAssignments: hash({ ...current, assignments: [] }) } } }
    expect(compareBackups(older, newer)).toEqual([])

    // Between two backups that both read assignments, an assignment change is a change.
    const unassigned = { Items: { [`ConfigurationPolicies/${POLICY}`]: { file: "7Zip.json", hash: hash({ ...current, assignments: [] }), hashWithEmptyAssignments: hash({ ...current, assignments: [] }) } } }
    expect(compareBackups(unassigned, newer)).toMatchObject([{ change: "modified" }])
    // A settings change against a legacy backup is still reported.
    const edited = { ...current, settings: [{ ...SETTING, id: "1" }] }
    expect(compareBackups(older, { Items: { [`ConfigurationPolicies/${POLICY}`]: { file: "7Zip.json", hash: hash(edited), hashWithEmptyAssignments: hash({ ...edited, assignments: [] }) } } })).toMatchObject([{ change: "modified" }])
  })

  it("does not report the assignments as drift, but still reports other changes", () => {
    expect(compareObjects(...withoutUnreadAssignments(type, legacy, current))).toEqual([])
    const renamed = { ...current, name: "7Zip - renamed" }
    expect(compareObjects(...withoutUnreadAssignments(type, legacy, renamed))).toEqual([{ field: "name", oldValue: legacy.name, newValue: "7Zip - renamed" }])
    // Two backups that both read assignments are compared in full.
    expect(compareObjects(...withoutUnreadAssignments(type, { ...current, assignments: [] }, current)).map((change) => change.field)).toEqual(["assignments[0]"])
  })

  it("leaves live assignments alone when replacing from such a backup, and says so", async () => {
    const live: Item = { ...structuredClone(current), name: "7Zip - edited", settings: [SETTING] }
    const graph = vi.fn<GraphCall>(async (method, path) => {
      const body: Item = method !== "GET" ? {} : path.endsWith("/assignments") ? { value: [ASSIGNMENT] } : content(live)
      return { status: method === "GET" ? 200 : 204, body }
    })
    const result = await new Restorer(graph, { mode: "replace", assignments: true }).restore(`backup/ConfigurationPolicies/7Zip.json`, legacy)

    expect(result).toMatchObject({ success: true, action: "updated" })
    expect(result.warnings?.join(" ")).toContain("could not read them")
    const writes = graph.mock.calls.filter(([method]) => method !== "GET").map(([method, path]) => `${method} ${path}`)
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.some((write) => write.endsWith("/assign"))).toBe(false)
  })

  it("says so also when the settings already match and nothing is written", async () => {
    const live: Item = structuredClone(current)
    const graph = vi.fn<GraphCall>(async (method, path) => ({ status: 200, body: method !== "GET" ? {} : path.endsWith("/assignments") ? { value: [ASSIGNMENT] } : content(live) }))
    const result = await new Restorer(graph, { mode: "replace", assignments: true }).restore(`backup/ConfigurationPolicies/7Zip.json`, legacy)

    expect(result).toMatchObject({ success: true, action: "unchanged" })
    expect(result.warnings?.join(" ")).toContain("could not read them")
    expect(graph.mock.calls.every(([method]) => method === "GET")).toBe(true)
  })
})
