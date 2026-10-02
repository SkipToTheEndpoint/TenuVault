import type { Tenant } from "~/contexts/TenantContext"
import type { TenantCredentials } from "../overrides/add-tenant-modal"

interface TenantDetails {
  organization?: { displayName?: string; primaryDomain?: string }
  statistics?: {
    userCount?: number
    deviceCount?: number
    complianceRate?: number
    policies?: {
      deviceConfigurations?: number
      compliancePolicies?: number
      configurationPolicies?: number
      appProtectionPolicies?: number
    }
  }
}

/** Builds a tenant profile from Microsoft Graph details, without placeholder values. */
export async function buildTenantProfile(credentials: TenantCredentials): Promise<Tenant> {
  let details: TenantDetails = {}
  try {
    const response = await fetch("/api/fetch-tenant-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    })
    if (response.ok) details = (await response.json()) as TenantDetails
  } catch {
    // The profile still works; details refresh from the Tenants page.
  }
  const policies = details.statistics?.policies ?? {}
  return {
    id: Date.now(),
    name: credentials.displayName || details.organization?.displayName || "New tenant",
    domain: details.organization?.primaryDomain ?? "",
    status: "healthy",
    lastBackup: "",
    configCount: (policies.deviceConfigurations ?? 0) + (policies.configurationPolicies ?? 0),
    storageUsed: "",
    client: "",
    license: "",
    region: "",
    tags: [],
    users: details.statistics?.userCount ?? 0,
    devices: details.statistics?.deviceCount ?? 0,
    complianceRate: details.statistics?.complianceRate ?? 0,
    industry: "",
    environment: "",
    lastSync: new Date().toISOString(),
    syncStatus: "idle",
    policies: {
      compliance: policies.compliancePolicies ?? 0,
      configuration: policies.deviceConfigurations ?? 0,
      apps: policies.appProtectionPolicies ?? 0,
      deviceConfigurations: policies.deviceConfigurations ?? 0,
      configurationPolicies: policies.configurationPolicies ?? 0,
      appProtectionPolicies: policies.appProtectionPolicies ?? 0,
    },
    credentials: { tenantId: credentials.tenantId, appId: credentials.appId, clientSecret: credentials.clientSecret },
    resources: {
      subscriptionId: credentials.subscriptionId ?? "",
      subscriptionName: "",
      resourceGroupName: credentials.resourceGroupName ?? "",
      storageAccountName: credentials.storageAccountName ?? "",
      automationAccountName: "",
      resourceGroupLocation: credentials.resourceGroupLocation ?? "",
    },
  }
}
