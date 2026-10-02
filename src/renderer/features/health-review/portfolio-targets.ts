import { useMemo } from "react"
import { useTenants, type Tenant } from "~/contexts/TenantContext"
import { tenantLicense, tenantPlan, useLicense } from "../../lib/license"

/**
 * The connected customer tenants a portfolio view may read: every other connected tenant on
 * MSP. The main process checks each target's plan again; tenants left out are listed so the
 * view never implies they were reviewed.
 */
export function usePortfolioTargets(tenant: Tenant): { included: Tenant[]; excluded: Tenant[]; ids: string[] } {
  const tenants = useTenants()
  const { status } = useLicense()
  const selectedId = tenant.credentials?.tenantId?.toLowerCase()
  return useMemo(() => {
    const others = tenants.filter((candidate) => candidate.credentials?.tenantId && candidate.credentials.tenantId.toLowerCase() !== selectedId)
    const licensed = (candidate: Tenant) => tenantPlan(tenantLicense(status, candidate.credentials?.tenantId)) === "msp"
    const included = others.filter(licensed)
    return { included, excluded: others.filter((candidate) => !licensed(candidate)), ids: included.map((candidate) => candidate.credentials!.tenantId!) }
  }, [tenants, status, selectedId])
}
