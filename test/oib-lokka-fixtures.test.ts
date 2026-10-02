import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { handleOib, setOibStore } from "../src/main/oib/service"
import { resetOibSource } from "../src/main/oib/source"
import type { Item } from "../src/shared/intune/registry"
import { validatePolicy } from "../src/shared/oib/compare"
import type { OibComparison, OibRun } from "../src/shared/oib/types"
import { memoryStore } from "./helpers"

/**
 * Microsoft Graph responses recorded in a lab tenant through Lokka (September 2026), with IDs and
 * tenant data replaced. See docs/roadmap/lokka-verification-oib.md.
 */

const ID = "00000000-0000-0000-0000-00000000000a"
const OIBID = "C933DA2A-916F-46D4-B2C8-52459180108B"
const CONFIG_REFRESH = "Win - OIB - SC - Device Security - D - Config Refresh - v3.2"
const COMPLIANCE_NAME = "Win - OIB - Compliance - U - Password - v3.1"
const COMPLIANCE_DESCRIPTION = "OIBID:10926D04-D949-40AA-BEDE-B6A9CA5E2723"

/** A Settings Catalog policy as the OIB pack stores it (the create body). */
const configRefreshPack: Item = {
  name: CONFIG_REFRESH, description: `OIBID:${OIBID}`, platforms: "windows10", technologies: "mdm",
  roleScopeTagIds: ["0"], templateReference: { templateId: "" },
  settings: [{ "@odata.type": "#microsoft.graph.deviceManagementConfigurationSetting", settingInstance: {
    "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingCollectionInstance", settingDefinitionId: "device_vendor_msft_dmclient_provider_{providerid}", settingInstanceTemplateReference: null,
    groupSettingCollectionValue: [{ "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingValue", settingValueTemplateReference: null, children: [
      { "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance", settingDefinitionId: "device_vendor_msft_dmclient_provider_{providerid}_configrefresh_enabled", settingInstanceTemplateReference: null,
        choiceSettingValue: { "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingValue", settingValueTemplateReference: null, value: "device_vendor_msft_dmclient_provider_{providerid}_configrefresh_enabled_true", children: [] } },
      { "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance", settingDefinitionId: "device_vendor_msft_dmclient_provider_{providerid}_configrefresh_cadence", settingInstanceTemplateReference: null,
        simpleSettingValue: { "@odata.type": "#microsoft.graph.deviceManagementConfigurationIntegerSettingValue", settingValueTemplateReference: null, value: 30 } },
    ] }],
  } }],
}

/** The same policy read back with GET configurationPolicies/{id}?$expand=settings,assignments: value @odata.type dropped, auditRuleInformation added. */
const configRefreshLive: Item = {
  id: ID, name: CONFIG_REFRESH, description: `OIBID:${OIBID}`, platforms: "windows10", technologies: "mdm", roleScopeTagIds: ["0"], settingCount: 1, creationSource: null, priorityMetaData: null,
  createdDateTime: "2026-09-30T17:46:53Z", lastModifiedDateTime: "2026-09-30T17:46:53Z",
  templateReference: { templateId: "", templateFamily: "none", templateDisplayName: null, templateDisplayVersion: null },
  settings: [{ id: "0", settingInstance: {
    "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingCollectionInstance", settingDefinitionId: "device_vendor_msft_dmclient_provider_{providerid}", settingInstanceTemplateReference: null, auditRuleInformation: null,
    groupSettingCollectionValue: [{ settingValueTemplateReference: null, children: [
      { "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance", settingDefinitionId: "device_vendor_msft_dmclient_provider_{providerid}_configrefresh_enabled", settingInstanceTemplateReference: null, auditRuleInformation: null,
        choiceSettingValue: { settingValueTemplateReference: null, value: "device_vendor_msft_dmclient_provider_{providerid}_configrefresh_enabled_true", children: [] } },
      { "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance", settingDefinitionId: "device_vendor_msft_dmclient_provider_{providerid}_configrefresh_cadence", settingInstanceTemplateReference: null, auditRuleInformation: null,
        simpleSettingValue: { "@odata.type": "#microsoft.graph.deviceManagementConfigurationIntegerSettingValue", settingValueTemplateReference: null, value: 30 } },
    ] }],
  } }],
  assignments: [],
}

const complianceSettings: Item = {
  passwordRequired: true, passwordBlockSimple: true, passwordRequiredToUnlockFromIdle: false, passwordMinutesOfInactivityBeforeLock: 15, passwordExpirationDays: null, passwordMinimumLength: 8,
  passwordMinimumCharacterSetCount: null, passwordRequiredType: "numeric", passwordPreviousPasswordBlockCount: null, requireHealthyDeviceReport: false, osMinimumVersion: null, osMaximumVersion: null,
  mobileOsMinimumVersion: null, mobileOsMaximumVersion: null, earlyLaunchAntiMalwareDriverEnabled: false, bitLockerEnabled: false, secureBootEnabled: false, codeIntegrityEnabled: false,
  memoryIntegrityEnabled: false, kernelDmaProtectionEnabled: false, virtualizationBasedSecurityEnabled: false, firmwareProtectionEnabled: false, storageRequireEncryption: false,
  activeFirewallRequired: false, defenderEnabled: false, defenderVersion: null, signatureOutOfDate: false, rtpEnabled: false, antivirusRequired: false, antiSpywareRequired: false,
  deviceThreatProtectionEnabled: false, deviceThreatProtectionRequiredSecurityLevel: "unavailable", configurationManagerComplianceRequired: false, tpmRequired: false,
  deviceCompliancePolicyScript: null, validOperatingSystemBuildRanges: [],
}
const compliancePack: Item = {
  "@odata.type": "#microsoft.graph.windows10CompliancePolicy", roleScopeTagIds: ["0"], description: COMPLIANCE_DESCRIPTION, displayName: COMPLIANCE_NAME,
  ...complianceSettings,
  scheduledActionsForRule: [{ "@odata.type": "#microsoft.graph.deviceComplianceScheduledActionForRule", ruleName: null, scheduledActionConfigurations: [{ "@odata.type": "#microsoft.graph.deviceComplianceActionItem", "@odata.id": "deviceManagement/deviceCompliancePolicies('x')", gracePeriodHours: 0, actionType: "block", notificationTemplateId: "00000000-0000-0000-0000-000000000000", notificationMessageCCList: [] }] }],
}
/** Read back with $expand=scheduledActionsForRule($expand=scheduledActionConfigurations),assignments: version and wslDistributions added, rule IDs assigned. */
const complianceLive = (minimumLength: number): Item => ({
  "@odata.type": "#microsoft.graph.windows10CompliancePolicy", roleScopeTagIds: ["0"], id: ID, createdDateTime: "2026-09-30T17:47:08Z", lastModifiedDateTime: "2026-09-30T17:53:20Z", version: 2,
  description: COMPLIANCE_DESCRIPTION, displayName: COMPLIANCE_NAME, ...complianceSettings, passwordMinimumLength: minimumLength, wslDistributions: [],
  scheduledActionsForRule: [{ id: ID, ruleName: null, scheduledActionConfigurations: [{ id: "00000000-0000-0000-0000-00000000000b", gracePeriodHours: 0, actionType: "block", notificationTemplateId: "00000000-0000-0000-0000-000000000000", notificationMessageCCList: [] }] }],
  assignments: [],
})

describe("OIB validation against recorded Graph responses", () => {
  it("treats a freshly created Settings Catalog policy as compliant despite the read-back shape", () => {
    expect(validatePolicy("ConfigurationPolicies", configRefreshPack, configRefreshLive)).toMatchObject({ compliant: true, matched: 1, totalOib: 1, totalTenant: 1 })
  })

  it("treats a freshly created compliance policy as compliant and reports a changed setting as drift", () => {
    expect(validatePolicy("CompliancePolicies", compliancePack, complianceLive(8))).toMatchObject({ compliant: true, matched: 26 })
    const drift = validatePolicy("CompliancePolicies", compliancePack, complianceLive(12))!
    expect(drift.compliant).toBe(false)
    expect(drift.mismatches).toEqual([{ settingDefinitionId: "passwordMinimumLength", label: "Password Minimum Length", oibValue: "8", tenantValue: "12" }])
  })
})

const tenantId = "11111111-1111-1111-1111-111111111111"
const appId = "22222222-2222-2222-2222-222222222222"
const commit = "b".repeat(40)
const DRIVER = "WINDOWS/IntuneManagement/DriverUpdateProfiles/Win - OIB - WUfB Drivers - Ring 2 - UAT - v3.0.json"
const SC = "WINDOWS/IntuneManagement/SettingsCatalog/Win - OIB - SC - Device Security - D - Config Refresh - v3.2.json"
const DRIVER_NAME = "Win - OIB - WUfB Drivers - Ring 2 - UAT - v3.0"
const driverPack: Item = { "@odata.type": "#microsoft.graph.windowsDriverUpdateProfile", displayName: DRIVER_NAME, description: "", approvalType: "automatic", deploymentDeferralInDays: 3, roleScopeTagIds: ["0"] }
/** POST windowsDriverUpdateProfiles in a tenant without the Autopatch entitlement. */
const driverForbidden = { error: { code: "Forbidden", message: "{\r\n  \"_version\": 3,\r\n  \"Message\": \"An error has occurred - Operation ID (for customer support): 00000000-0000-0000-0000-000000000000 - Activity ID: x - Url: https://example/deviceManagement/windowsDriverUpdateProfiles\",\r\n  \"CustomApiErrorPhrase\": \"\",\r\n  \"RetryAfter\": null,\r\n  \"ErrorSourceService\": \"\",\r\n  \"HttpHeaders\": \"{}\"\r\n}" } }

function world(graph: (method: string, path: string) => Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/commits/main")) return Response.json({ sha: commit })
    if (url.includes("/git/trees/")) return Response.json({ truncated: false, tree: [{ type: "blob", path: DRIVER }, { type: "blob", path: SC }] })
    if (url.startsWith("https://raw.githubusercontent.com/")) return Response.json(url.includes("DriverUpdateProfiles") ? driverPack : configRefreshPack)
    if (url.includes("oauth2")) return Response.json({ access_token: "test" })
    return graph(init?.method ?? "GET", url.replace("https://graph.microsoft.com/beta/", ""))
  })
}

beforeEach(() => { setOibStore(memoryStore()); resetOibSource() })
afterEach(() => { vi.unstubAllGlobals(); setOibStore(null) })

describe("OIB deployment against recorded Graph responses", () => {
  it("explains the license a driver update profile needs when Graph refuses it with a bare 403", async () => {
    vi.stubGlobal("fetch", world((method, path) => {
      if (method === "GET") return Response.json({ value: [] })
      if (method === "POST" && path === "deviceManagement/windowsDriverUpdateProfiles") return Response.json(driverForbidden, { status: 403 })
      throw new Error(`unexpected ${method} ${path}`)
    }))
    await handleOib({ action: "oib-source" })
    const run = await handleOib({ action: "oib-deploy", tenantId, appId, platform: "windows", commit, backup: false, items: [{ source: DRIVER, mode: "create" }] }) as OibRun
    expect(run.created).toEqual([])
    expect(run.failed).toEqual([{ name: DRIVER_NAME, error: expect.stringContaining("Autopatch entitlement") }])
    expect(run.failed[0]!.error).toMatch(/^An error has occurred\. Driver update profiles/)
  })

  it("fails the comparison instead of reporting deployed policies as missing when the listing does not end", async () => {
    let pages = 0
    vi.stubGlobal("fetch", world((method, path) => {
      if (method === "GET" && path.startsWith("deviceManagement/configurationPolicies?")) {
        pages++
        return Response.json({ value: [], "@odata.nextLink": `https://graph.microsoft.com/beta/deviceManagement/configurationPolicies?$select=id%2cname%2cdescription&$skiptoken=${pages}` })
      }
      return Response.json({ value: [] })
    }))
    await handleOib({ action: "oib-source" })
    await expect(handleOib({ action: "oib-compare", tenantId, appId, platform: "windows", commit }) as Promise<OibComparison>).rejects.toThrow("could not be read completely")
    expect(pages).toBe(1000)
  })
})
