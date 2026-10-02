import type { OibPolicy } from "./types"

export interface TenantProfile {
  licensing: "business-premium" | "enterprise"
  /** Defender for Endpoint is the primary antivirus. */
  defenderAv: boolean
  /** Windows Update is managed by Autopatch. */
  autopatch: boolean
}

export const POLICY_TYPES: Record<string, { name: string; description: string }> = {
  SettingsCatalog: { name: "Settings Catalog", description: "Device management and user experience settings" },
  EndpointSecurity: { name: "Endpoint Security", description: "Antivirus, firewall, disk encryption and other Endpoint security profiles" },
  CompliancePolicies: { name: "Compliance Policies", description: "Device compliance requirements and health checks" },
  UpdatePolicies: { name: "Update Policies", description: "Windows Update ring configuration" },
  DriverUpdateProfiles: { name: "Driver Update Policies", description: "Windows Update driver configuration" },
  DeviceConfiguration: { name: "Endpoint Analytics", description: "Device health monitoring and analytics" },
  AdminTemplates: { name: "Administrative Templates", description: "Group Policy style administrative template configurations" },
  AppProtection: { name: "App Protection", description: "iOS and Android app protection policies for personal devices" },
}

export const policyTypeName = (type: string) => POLICY_TYPES[type]?.name ?? type.replace(/([a-z])([A-Z])/g, "$1 $2")

/**
 * Types that need a Windows Enterprise entitlement, not included in Business Premium. Driver
 * updates are not one: they need the Windows Autopatch entitlement, which Business Premium,
 * Enterprise E3/E5, A3/A5 and F3 include (Microsoft Learn, Windows Autopatch prerequisites).
 */
const ENTERPRISE_ONLY_TYPES: string[] = []
/** Types that conflict with updates managed by Autopatch. */
const AUTOPATCH_TYPES = ["UpdatePolicies", "DriverUpdateProfiles"]

const ENTERPRISE = "Requires a Windows Enterprise entitlement (Microsoft 365 E3, E5 or E7)."

/** Why a whole policy type does not suit the tenant, or undefined. */
export function typeGate(policyType: string, profile: TenantProfile): string | undefined {
  if (profile.autopatch && AUTOPATCH_TYPES.includes(policyType)) return "Autopatch manages Windows Update for this tenant."
  if (profile.licensing !== "enterprise" && ENTERPRISE_ONLY_TYPES.includes(policyType)) return ENTERPRISE
  return undefined
}

/** Why a policy does not suit the tenant (from PolicyManifest.json requirements), or undefined. */
export function policyGate(policy: OibPolicy, profile: TenantProfile): string | undefined {
  const type = typeGate(policy.policyType, profile)
  if (type) return type
  if (policy.skuRequirements.toLowerCase() === "enterprise" && profile.licensing !== "enterprise") return ENTERPRISE
  if (policy.licenseRequirements.toUpperCase() === "MDE" && !profile.defenderAv) return "Requires Defender for Endpoint as the primary antivirus."
  return undefined
}
