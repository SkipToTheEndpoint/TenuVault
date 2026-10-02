import { useMutation } from "@tanstack/react-query"
import { Building2 } from "lucide-react"
import type { Tenant } from "~/contexts/TenantContext"
import { Chip, Tile } from "~/components/dashboard/tiles"
import type { Plan } from "../../../shared/plans"
import { GatedButton } from "../../components/PlanGate"
import { formatTime, healthApi, OUTCOME_LABELS } from "./api"
import { usePortfolioTargets } from "./portfolio-targets"

/**
 * MSP portfolio triage: the stored health review status of each licensed customer tenant,
 * with owners of open findings. A tenant never reviewed is shown as unknown.
 */
export function PortfolioHealth({ tenant, plan }: { tenant: Tenant; plan: Plan | null }) {
  const { excluded, ids } = usePortfolioTargets(tenant)
  const load = useMutation({ mutationFn: () => healthApi.portfolio(tenant, ids) })
  return (
    <Tile aria-labelledby="health-portfolio-heading" className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="health-portfolio-heading" className="flex items-center gap-2 text-lg font-medium text-gray-900">
            <Building2 className="h-4 w-4 text-gray-500" aria-hidden="true" />
            Customer triage
          </h3>
          <p className="text-sm text-gray-500">Last review, outcome and owners per customer tenant, from each tenant's own stored reviews.</p>
        </div>
        <GatedButton feature="portfolio" plan={plan} variant="outline" size="sm" disabled={load.isPending} onClick={() => load.mutate()}>
          {load.isPending ? "Loading" : load.data ? "Refresh" : "Load customers"}
        </GatedButton>
      </div>
      {excluded.length > 0 && <p className="text-xs text-gray-500">Not included (no MSP license or not signed in): {excluded.map((candidate) => candidate.name).join(", ")}.</p>}
      {load.error && <p className="text-sm text-red-700" role="alert">{load.error instanceof Error ? load.error.message : "Could not load customers."}</p>}
      {load.data && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Health review status per customer tenant</caption>
            <thead className="text-xs text-gray-500">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">Customer</th>
                <th scope="col" className="py-2 pr-4 font-medium">Last review</th>
                <th scope="col" className="py-2 pr-4 font-medium">Open findings</th>
                <th scope="col" className="py-2 pr-4 font-medium">Schedule</th>
                <th scope="col" className="py-2 font-medium">Owners</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {load.data.tenants.map((row) => {
                const open = row.counts.critical + row.counts.high + row.counts.medium + row.counts.low
                return (
                  <tr key={row.tenantId}>
                    <th scope="row" className="py-2 pr-4 font-normal text-gray-800">{row.name ?? row.tenantId}</th>
                    <td className="py-2 pr-4 text-gray-700">
                      {row.lastReviewAt ? formatTime(row.lastReviewAt) : <Chip tone="warning">Never reviewed: unknown</Chip>}
                      {row.lastOutcome && <span className="block text-xs text-gray-500">{OUTCOME_LABELS[row.lastOutcome] ?? row.lastOutcome}</span>}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-gray-700">
                      {row.lastReviewAt ? open : "Unknown"}
                      {row.counts.critical > 0 && <span className="ml-2"><Chip tone="danger">{row.counts.critical} critical</Chip></span>}
                      {row.counts.unknown > 0 && <span className="block text-xs text-gray-500">{row.counts.unknown} with unknown evidence</span>}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {row.scheduleEnabled ? `Next ${formatTime(row.nextDueAt, "now")}` : "Off"}
                      {!row.signedIn && <span className="block text-xs text-amber-800">Not signed in</span>}
                    </td>
                    <td className="py-2 text-gray-700">{row.owners.length ? row.owners.join(", ") : "Unassigned"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Tile>
  )
}
