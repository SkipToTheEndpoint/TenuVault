import type { BackupScopeSetting } from "../../shared/ipc"
import { DEFAULT_SCOPE, EVERYTHING, normalizeScope, type BackupScope } from "../../shared/intune/scope"
import type { KeyValueStore } from "../storage/secure-store"

const KEY = "backup.scopes"

/**
 * What each tenant backs up, used by scheduled backups, "Back up all tenants now" and as the
 * starting point of a manual backup. Tenants without a saved scope use DEFAULT_SCOPE.
 */
export class BackupScopes {
  constructor(
    private readonly store: KeyValueStore,
    private readonly onChange: () => void = () => undefined,
  ) {}

  /**
   * Tenants with a schedule from before scopes existed backed up everything. They keep doing so
   * until the admin changes it, so an update never silently drops apps from their backups.
   */
  migrate(scheduledTenantIds: string[]): void {
    if (this.store.get(KEY) !== null) return
    this.write(Object.fromEntries(scheduledTenantIds.map((id) => [id.toLowerCase(), EVERYTHING])))
  }

  get(tenantId: string): BackupScopeSetting {
    const saved = this.read()[tenantId.toLowerCase()]
    return saved ? { scope: normalizeScope(saved), saved: true } : { scope: DEFAULT_SCOPE, saved: false }
  }

  set(tenantId: string, scope: BackupScope): BackupScopeSetting {
    const all = this.read()
    all[tenantId.toLowerCase()] = normalizeScope(scope)
    this.write(all)
    return this.get(tenantId)
  }

  private read(): Record<string, BackupScope> {
    try {
      const parsed: unknown = JSON.parse(this.store.get(KEY) ?? "{}")
      return parsed && typeof parsed === "object" ? (parsed as Record<string, BackupScope>) : {}
    } catch {
      return {}
    }
  }

  private write(all: Record<string, BackupScope>): void {
    this.store.set(KEY, JSON.stringify(all))
    this.onChange()
  }
}
