import { useMemo } from "react"
import { useMutation } from "@tanstack/react-query"
import { Building2 } from "lucide-react"
import { useTenants, type Tenant } from "~/contexts/TenantContext"
import type { Plan } from "../../../shared/plans"
import { GatedButton } from "../../components/PlanGate"
import { tenantLicense, tenantPlan, useLicense } from "../../lib/license"
import { formatDate, loadFleet } from "./api"

/**
 * MSP fleet summary: per customer counts and the open definite queue, each from that
 * customer's own stored findings. Tenants without MSP are listed as not included.
 */
export function FleetSummary({ tenant, plan }: { tenant: Tenant; plan: Plan | null }) {
  const tenants = useTenants()
  const { status } = useLicense()
  const selectedId = tenant.credentials?.tenantId?.toLowerCase()
  const { included, excluded } = useMemo(() => {
    const others = tenants.filter((candidate) => candidate.credentials?.tenantId && candidate.credentials.tenantId.toLowerCase() !== selectedId)
    const licensed = (candidate: Tenant) => tenantPlan(tenantLicense(status, candidate.credentials?.tenantId)) === "msp"
    return { included: others.filter(licensed), excluded: others.filter((candidate) => !licensed(candidate)) }
  }, [tenants, status, selectedId])
  const load = useMutation({ mutationFn: () => loadFleet(tenant, included.map((candidate) => candidate.credentials!.tenantId!)) })

  return (
    <section aria-label="Fleet hygiene summary" className="space-y-4 rounded-3xl bg-card p-6 shadow-[0_1px_2px_rgba(22,21,20,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-medium text-gray-900">
            <Building2 className="h-4 w-4 text-gray-500" aria-hidden="true" />
            Fleet summary
          </h3>
          <p className="text-sm text-gray-500">Stored findings per customer tenant. Each customer is scanned and reviewed on its own.</p>
        </div>
        <GatedButton feature="portfolio" plan={plan} variant="outline" size="sm" disabled={load.isPending} onClick={() => load.mutate()}>
          {load.isPending ? "Loading" : load.data ? "Refresh fleet" : "Load fleet summary"}
        </GatedButton>
      </div>
      {excluded.length > 0 && <p className="text-xs text-gray-500">Not included (no MSP license or not signed in): {excluded.map((candidate) => candidate.name).join(", ")}.</p>}
      {load.error && <p className="text-sm text-red-700 dark:text-red-400">{load.error instanceof Error ? load.error.message : "The fleet summary could not be loaded."}</p>}
      {load.data && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-gray-500">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">Tenant</th>
                <th scope="col" className="py-2 pr-4 font-medium">Collected</th>
                <th scope="col" className="py-2 pr-4 font-medium">Open definite</th>
                <th scope="col" className="py-2 pr-4 font-medium">Open possible</th>
                <th scope="col" className="py-2 pr-4 font-medium">Reviewed</th>
                <th scope="col" className="py-2 font-medium">Top of queue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {load.data.tenants.map((row) => (
                <tr key={row.tenantId}>
                  <td className="py-2 pr-4 text-gray-800">{row.name}</td>
                  <td className="py-2 pr-4 text-gray-700">{row.latestScan ? `${formatDate(row.latestScan.collectedAt)}${row.latestScan.completeness === "partial" ? " (partial)" : ""}` : "Never scanned"}</td>
                  <td className="py-2 pr-4 tabular-nums text-gray-900">{row.latestScan ? row.counts.openDefinite : "Unknown"}</td>
                  <td className="py-2 pr-4 tabular-nums text-gray-700">{row.latestScan ? row.counts.openPossible : "Unknown"}</td>
                  <td className="py-2 pr-4 tabular-nums text-gray-700">{row.counts.acknowledged + row.counts.falsePositive}</td>
                  <td className="py-2 text-gray-700">{row.queue[0]?.title ?? (row.latestScan ? "Nothing open" : "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
