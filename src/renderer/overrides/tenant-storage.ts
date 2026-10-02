import { bridge } from "../lib/bridge"

/**
 * Desktop replacement for ~/lib/tenant-storage.
 *
 * Tenant profiles persist across restarts in the main process's OS-encrypted store
 * instead of browser session storage. Desktop profiles hold no secrets (see
 * DELEGATED_CLIENT_SECRET); profiles created by the onboarding wizard for the unattended
 * backup app registration are protected by DPAPI or the macOS Keychain.
 *
 * When a tenant disappears from the list, its license activation is released, which frees
 * its tenant slot on the license, and its sign-in and schedule are removed. At startup,
 * activations of sign-ins that never became a saved tenant (for example when the admin
 * cancelled the resource picker), or whose release failed, are released as well.
 */

const TENANTS_KEY = "tenuvault_tenants"

function tenantIds(serialized: string | null): Set<string> {
  if (!serialized) return new Set()
  try {
    const tenants = JSON.parse(serialized) as Array<{ credentials?: { tenantId?: string } }>
    return new Set(tenants.map((t) => t.credentials?.tenantId?.toLowerCase()).filter((id): id is string => Boolean(id)))
  } catch {
    return new Set()
  }
}

const cache = new Map<string, string | null>()

async function releaseOrphanedTenants(saved: Set<string>): Promise<void> {
  const status = await bridge.license.status()
  for (const { tenantId } of status.tenants.filter((tenant) => tenant.activated)) {
    if (!saved.has(tenantId)) await bridge.license.releaseTenant(tenantId)
  }
}

export const tenantStorage = {
  getItem(key: string): string | null {
    if (!cache.has(key)) {
      const value = bridge.storage.getItemSync(key)
      cache.set(key, value)
      if (key === TENANTS_KEY) void releaseOrphanedTenants(tenantIds(value))
    }
    return cache.get(key) ?? null
  },
  setItem(key: string, value: string): void {
    if (key === TENANTS_KEY) {
      const next = tenantIds(value)
      for (const id of tenantIds(tenantStorage.getItem(key))) {
        if (!next.has(id)) void bridge.license.releaseTenant(id)
      }
    }
    cache.set(key, value)
    void bridge.storage.setItem(key, value)
  },
  removeItem(key: string): void {
    cache.set(key, null)
    void bridge.storage.removeItem(key)
  },
}
