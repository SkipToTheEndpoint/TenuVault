import type { Tenant } from "~/contexts/TenantContext"
import type { Plan } from "../../shared/plans"

/** What every roadmap screen receives from its hub. */
export interface FeatureTabProps {
  tenant: Tenant
  /** The tenant's plan; null while it loads or when the license does not cover the tenant. */
  plan: Plan | null
  /**
   * Whether the plan includes this screen's feature. When false the hub already shows the
   * locked preview above; the screen shows only records stored earlier, read-only, and
   * renders nothing when there are none.
   */
  allowed: boolean
}
