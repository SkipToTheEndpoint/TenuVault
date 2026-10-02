/**
 * Display name for where a tenant's backups are stored.
 *
 * The desktop app can keep backups encrypted on the admin's device; those tenants use a
 * `tvlocal-` storage account name that is served locally and never exists in Azure.
 */
export function storageLabel(storageAccountName: string | undefined): string {
  if (!storageAccountName) return "Not configured"
  return storageAccountName.startsWith("tvlocal-") ? "This device (encrypted)" : storageAccountName
}
