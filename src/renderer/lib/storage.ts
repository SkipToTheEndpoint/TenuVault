import { DELEGATED_CLIENT_SECRET, localStorageAccountName } from "../../shared/constants"

/** Where a tenant's backups are stored. */
export type StorageChoice =
  | { kind: "local" }
  | { kind: "azure"; storageAccountName: string; subscriptionId: string; resourceGroupName: string; location: string }

export interface AzureStorageAccount {
  name: string
  subscriptionId: string
  resourceGroup: string
  location: string
}

/**
 * Tenant resource fields for a storage choice. Local storage uses placeholder
 * subscription and resource group values because the shared routes require them
 * but never use them for local accounts.
 */
export function storageResources(tenantId: string, choice: StorageChoice) {
  return choice.kind === "local"
    ? {
        storageAccountName: localStorageAccountName(tenantId),
        subscriptionId: "local",
        resourceGroupName: "local",
        resourceGroupLocation: "",
      }
    : {
        storageAccountName: choice.storageAccountName,
        subscriptionId: choice.subscriptionId,
        resourceGroupName: choice.resourceGroupName,
        resourceGroupLocation: choice.location,
      }
}

export async function listStorageAccounts(tenantId: string, clientId: string): Promise<AzureStorageAccount[]> {
  const response = await fetch("/api/list-azure-resources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId, appId: clientId, clientSecret: DELEGATED_CLIENT_SECRET }),
  })
  const data = (await response.json()) as { storageAccounts?: AzureStorageAccount[]; error?: string }
  if (!response.ok) throw new Error(data.error ?? "Could not list your Azure storage accounts.")
  return (data.storageAccounts ?? []).sort((a, b) => a.name.localeCompare(b.name))
}
