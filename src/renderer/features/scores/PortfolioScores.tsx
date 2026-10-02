import { useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Building2 } from "lucide-react"
import { useTenants, type Tenant } from "~/contexts/TenantContext"
import { Chip } from "~/components/dashboard/tiles"
import type { Plan } from "../../../shared/plans"
import { GatedButton } from "../../components/PlanGate"
import { tenantLicense, tenantPlan, useLicense } from "../../lib/license"
import { formatDate, formatPercent, loadPortfolio, type PortfolioTenant } from "./api"
import { ScoreDetail } from "./ScoreDetail"

/**
 * MSP portfolio: scores of every connected tenant whose license includes the portfolio, each
 * with its own freshness and coverage, and a drill-down to that tenant's source controls.
 * Tenants that are not licensed for it are listed as not included, never guessed.
 */
export function PortfolioScores({ tenant, plan }: { tenant: Tenant; plan: Plan | null }) {
  const tenants = useTenants()
  const { status } = useLicense()
  const [drill, setDrill] = useState<{ tenant: Tenant; frameworkId: string } | null>(null)
  const selectedId = tenant.credentials?.tenantId?.toLowerCase()
  const { included, excluded } = useMemo(() => {
    const others = tenants.filter((candidate) => candidate.credentials?.tenantId && candidate.credentials.tenantId.toLowerCase() !== selectedId)
    const licensed = (candidate: Tenant) => tenantPlan(tenantLicense(status, candidate.credentials?.tenantId)) === "msp"
    return { included: others.filter(licensed), excluded: others.filter((candidate) => !licensed(candidate)) }
  }, [tenants, status, selectedId])
  const load = useMutation({ mutationFn: () => loadPortfolio(tenant, included.map((candidate) => candidate.credentials!.tenantId!)) })
  const byId = (id: string) => tenants.find((candidate) => candidate.credentials?.tenantId?.toLowerCase() === id)

  return (
    <section aria-label="Portfolio scores" className="space-y-4 rounded-3xl bg-card p-6 shadow-[0_1px_2px_rgba(22,21,20,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-medium text-gray-900">
            <Building2 className="h-4 w-4 text-gray-500" aria-hidden="true" />
            Portfolio
          </h3>
          <p className="text-sm text-gray-500">Scores per customer tenant from each tenant's own saved comparisons.</p>
        </div>
        <GatedButton feature="portfolio" plan={plan} variant="outline" size="sm" disabled={load.isPending} onClick={() => load.mutate()}>
          {load.isPending ? "Loading" : load.data ? "Refresh portfolio" : "Load portfolio"}
        </GatedButton>
      </div>
      {excluded.length > 0 && <p className="text-xs text-gray-500">Not included (no MSP license or not signed in): {excluded.map((candidate) => candidate.name).join(", ")}.</p>}
      {load.error && <p className="text-sm text-red-700">{load.error instanceof Error ? load.error.message : "The portfolio could not be loaded."}</p>}
      {load.data && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-gray-500">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">Tenant</th>
                <th scope="col" className="py-2 pr-4 font-medium">Framework</th>
                <th scope="col" className="py-2 pr-4 font-medium">Score</th>
                <th scope="col" className="py-2 pr-4 font-medium">Coverage</th>
                <th scope="col" className="py-2 pr-4 font-medium">Assessed</th>
                <th scope="col" className="py-2 font-medium"><span className="sr-only">Drill down</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {load.data.tenants.flatMap((row: PortfolioTenant) => {
                const assessed = row.frameworks.filter((framework) => framework.state !== "not-assessed")
                if (row.error || !assessed.length) {
                  return [
                    <tr key={row.tenantId}>
                      <td className="py-2 pr-4 text-gray-800">{row.tenantName ?? row.tenantId}</td>
                      <td colSpan={5} className="py-2 text-gray-500">{row.error ?? "No saved comparison yet."}</td>
                    </tr>,
                  ]
                }
                return assessed.map((framework) => {
                  const target = byId(row.tenantId)
                  return (
                    <tr key={`${row.tenantId}:${framework.frameworkId}`}>
                      <td className="py-2 pr-4 text-gray-800">{row.tenantName ?? row.tenantId}</td>
                      <td className="py-2 pr-4 text-gray-700">
                        {framework.frameworkName}
                        {framework.version && <span className="block text-xs text-gray-500">{framework.version}</span>}
                      </td>
                      <td className="py-2 pr-4 tabular-nums text-gray-900">{framework.state === "unavailable" ? "Unavailable" : formatPercent(framework.score)}</td>
                      <td className="py-2 pr-4 tabular-nums text-gray-700">
                        {formatPercent(framework.coverage, "None")}
                        {framework.unknown ? <span className="block text-xs text-gray-500">{framework.unknown} unknown</span> : null}
                      </td>
                      <td className="py-2 pr-4 text-gray-700">
                        {formatDate(framework.assessedAt)}
                        <span className="ml-1 inline-flex gap-1">
                          {framework.stale && <Chip tone="warning">Stale</Chip>}
                          {framework.partial && <Chip tone="warning">Partial</Chip>}
                        </span>
                        {framework.state === "unavailable" && framework.message && <span className="block text-xs text-gray-500">{framework.message}</span>}
                      </td>
                      <td className="py-2 text-right">
                        {target && framework.state !== "unavailable" && (
                          <button type="button" aria-label={`Controls for ${row.tenantName ?? row.tenantId}, ${framework.frameworkName}`} className="text-sm font-medium text-gray-800 underline underline-offset-2 hover:text-gray-950" onClick={() => setDrill({ tenant: target, frameworkId: framework.frameworkId })}>
                            Controls
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              })}
            </tbody>
          </table>
        </div>
      )}
      {drill && <ScoreDetail key={`${drill.tenant.id}:${drill.frameworkId}`} tenant={drill.tenant} frameworkId={drill.frameworkId} onClose={() => setDrill(null)} />}
    </section>
  )
}
