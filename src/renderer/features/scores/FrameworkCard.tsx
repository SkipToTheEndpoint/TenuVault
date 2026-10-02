import { Link } from "react-router-dom"
import { ArrowUpRight, ListTree } from "lucide-react"
import { Button } from "~/components/ui/button"
import { Chip } from "~/components/dashboard/tiles"
import type { FrameworkScore } from "./api"
import { formatDate, formatPercent, scopeLabel } from "./api"
import { Trend } from "./Trend"

const PRIORITY_TONE = { critical: "danger", high: "warning", medium: "neutral", low: "neutral" } as const

/** One framework's score from its newest saved comparison, with coverage and top gaps. */
export function FrameworkCard({ score, tenantName, onDrillDown, selected }: { score: FrameworkScore; tenantName: string; onDrillDown: () => void; selected: boolean }) {
  const latest = score.latest
  if (!latest) return null
  const { identity, freshness } = latest
  const scored = latest.score.state === "scored"
  return (
    <section aria-label={`${identity.frameworkName} score`} className="flex flex-col gap-5 rounded-3xl bg-card p-6 shadow-[0_1px_2px_rgba(22,21,20,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-medium text-gray-900">{identity.frameworkName}</h3>
          <p className="text-sm text-gray-500">
            Version {identity.frameworkVersion}, {identity.profile}, mapping {identity.rulesetVersion}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {freshness.stale && <Chip tone="warning" title={`Older than the stale limit`}>Stale</Chip>}
          {latest.incompleteCollection.length > 0 && <Chip tone="warning" title={latest.incompleteCollection.join("; ")}>Partial collection</Chip>}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="text-sm text-gray-500">Technical score</p>
          <p className="text-4xl font-light tracking-tight text-gray-900 tabular-nums">{scored ? formatPercent(latest.score.score) : "Not scored"}</p>
          {!scored && <p className="mt-1 max-w-xs text-sm text-gray-600">{latest.score.reason}</p>}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-gray-500">Coverage</dt>
            <dd className="font-medium text-gray-900 tabular-nums">{formatPercent(latest.score.coverage, "None")}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Unknown</dt>
            <dd className="font-medium text-gray-900 tabular-nums">{latest.score.counts.unknown}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Gaps</dt>
            <dd className="font-medium text-gray-900 tabular-nums">{latest.gapCount}</dd>
          </div>
        </dl>
      </div>

      <p className="text-xs text-gray-500">
        {latest.score.counts.matching} matching, {latest.score.counts.different} different, {latest.score.counts.missing} missing, {latest.score.counts.unknown} unknown, {latest.score.counts.outsideScope} outside scope. Tenant {tenantName}. Assessed {formatDate(freshness.assessedAt)}
        {freshness.ageDays !== null ? ` (${freshness.ageDays} day${freshness.ageDays === 1 ? "" : "s"} ago)` : ""}. Scope: {scopeLabel(identity.platforms)}.
      </p>

      <Trend score={score} />
      {score.message && <p className="text-xs text-gray-500">{score.message}</p>}

      {latest.topGaps.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500">Top actionable gaps</p>
          <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
            {latest.topGaps.map((gap) => (
              <li key={gap.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 text-gray-800">
                  {gap.capabilityName}
                  <span className="text-gray-500"> ({gap.result === "different" ? "different value" : "missing"}, {gap.controls.length} control{gap.controls.length === 1 ? "" : "s"})</span>
                </span>
                <span className="flex gap-1.5">
                  {gap.mixed && <Chip tone="warning">Mixed evidence</Chip>}
                  <Chip tone={PRIORITY_TONE[gap.ranking.level]} title={gap.ranking.reasons.join(" ")}>{gap.ranking.level}</Chip>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2">
        <Button type="button" variant={selected ? "default" : "outline"} size="sm" onClick={onDrillDown} aria-pressed={selected}>
          <ListTree className="h-4 w-4" />
          Controls and gaps
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to={score.frameworkId.startsWith("oib-") ? "/portal/oib/validate" : `/portal/frameworks/${score.frameworkId}`}>
            Open comparison
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </section>
  )
}
