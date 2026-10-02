import { useQuery } from "@tanstack/react-query"
import { X } from "lucide-react"
import type { Tenant } from "~/contexts/TenantContext"
import { Button } from "~/components/ui/button"
import { Chip } from "~/components/dashboard/tiles"
import { CONTROL_STATUS_LABELS } from "../../../shared/compliance/presentation"
import { formatDate, formatPercent, loadDetail, scopeLabel } from "./api"

/**
 * Drill-down of a framework score to its source controls and every gap of the saved
 * comparison. Used for the selected tenant and, for MSP, for a tenant picked in the portfolio.
 */
export function ScoreDetail({ tenant, frameworkId, onClose }: { tenant: Tenant; frameworkId: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ["scores-detail", tenant.credentials?.tenantId, frameworkId], queryFn: () => loadDetail(tenant, frameworkId) })
  const detail = query.data?.detail

  return (
    <section aria-label="Controls and gaps" className="space-y-5 rounded-3xl bg-card p-6 shadow-[0_1px_2px_rgba(22,21,20,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium text-gray-900">{detail ? `${detail.identity.frameworkName}: controls and gaps` : "Controls and gaps"}</h3>
          <p className="text-sm text-gray-500">
            {query.data?.tenantName ?? tenant.name}
            {detail && `, assessed ${formatDate(detail.freshness.assessedAt)}, ${scopeLabel(detail.identity.platforms)}, score ${formatPercent(detail.score.score)}, coverage ${formatPercent(detail.score.coverage, "none")}`}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
          Close
        </Button>
      </div>

      {query.isLoading && <div className="h-24 animate-pulse rounded-2xl bg-gray-100" />}
      {query.error && <p className="text-sm text-red-700">{query.error instanceof Error ? query.error.message : "The comparison could not be read."}</p>}

      {detail && (
        <>
          {detail.incompleteCollection.length > 0 && (
            <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Collection was incomplete ({detail.incompleteCollection.join("; ")}). Missing results in these families may be unknown rather than absent.
            </p>
          )}
          {detail.unassessedNote && <p className="text-xs text-gray-500">{detail.unassessedNote}</p>}

          <div>
            <h4 className="text-sm font-medium text-gray-900">Gaps ({detail.gaps.length})</h4>
            {detail.gaps.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">No evaluated setting differs or is missing. Unknown results are not counted as matches.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {detail.gaps.map((gap) => (
                  <li key={gap.key} className="rounded-2xl bg-gray-50 p-4 text-sm dark:bg-gray-900/40">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-gray-900">{gap.capabilityName}</span>
                      <span className="flex flex-wrap gap-1.5">
                        {gap.mixed && <Chip tone="warning">Mixed evidence</Chip>}
                        <Chip tone={gap.ranking.level === "critical" ? "danger" : gap.ranking.level === "high" ? "warning" : "neutral"}>{gap.ranking.level}</Chip>
                      </span>
                    </div>
                    <p className="mt-1 text-gray-600">Controls: {gap.controls.map((control) => `${control.id} ${control.title}`).join("; ") || "None mapped"}</p>
                    <ul className="mt-2 space-y-1 text-xs text-gray-600">
                      {gap.settings.map((setting, index) => (
                        <li key={`${setting.settingId}:${setting.policyId ?? index}`} className="break-words">
                          <span className="font-mono text-gray-800">{setting.settingId}</span>: {setting.result === "different" ? `observed ${setting.observed ?? "no value"}` : "missing"}, expected {setting.expected}
                          {setting.policyId ? ` (policy ${gap.policies.find((policy) => policy.policyId === setting.policyId)?.policyName ?? setting.policyId})` : ""}
                        </li>
                      ))}
                    </ul>
                    {gap.limitations.length > 0 && <p className="mt-2 text-xs text-amber-800">{gap.limitations.join(" ")}</p>}
                    <p className="mt-2 text-xs text-gray-500">Priority reasons: {gap.ranking.reasons.join(" ")}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="overflow-x-auto">
            <h4 className="text-sm font-medium text-gray-900">Source controls ({detail.controls.length})</h4>
            <table className="mt-2 w-full text-left text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">Control</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                  <th scope="col" className="py-2 font-medium">Gaps</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {detail.controls.map((control) => (
                  <tr key={control.id}>
                    <td className="py-2 pr-4 text-gray-800">
                      <span className="font-mono text-xs">{control.id}</span> {control.title}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{control.unavailable ? `Not checkable: ${control.unavailable}` : CONTROL_STATUS_LABELS[control.status]}</td>
                    <td className="py-2 text-gray-600 tabular-nums">{control.gapCapabilityIds.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
