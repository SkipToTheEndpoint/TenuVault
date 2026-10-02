import { useState } from "react"
import type { FrameworkScore } from "./api"
import { formatDate, formatPercent } from "./api"

/**
 * The compatible trend of a framework as a small line, oldest to newest. A comparison without
 * a score breaks the line instead of being bridged. Incompatible comparisons are listed
 * separately with the reason they are not connected.
 */
export function Trend({ score }: { score: FrameworkScore }) {
  const [open, setOpen] = useState(false)
  const points = score.trend
  const width = 180
  const height = 44
  const step = points.length > 1 ? width / (points.length - 1) : 0
  const segments: string[] = []
  let current = ""
  points.forEach((point, index) => {
    if (point.score === null) {
      if (current) segments.push(current)
      current = ""
      return
    }
    const x = points.length > 1 ? index * step : width / 2
    const y = height - 4 - (point.score / 100) * (height - 8)
    current += `${current ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `
  })
  if (current) segments.push(current)
  const description = points.map((point) => `${formatDate(point.assessedAt)}: ${formatPercent(point.score)}`).join("; ")

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-500">Trend of compatible comparisons ({points.length})</p>
      {points.length > 1 ? (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Score trend: ${description}`} className="text-coral-500">
          <line x1={0} x2={width} y1={height - 4} y2={height - 4} stroke="currentColor" strokeOpacity={0.15} />
          {segments.map((path) => (
            <path key={path} d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {points.map((point, index) =>
            point.score === null ? null : <circle key={point.runId} cx={points.length > 1 ? index * step : width / 2} cy={height - 4 - (point.score / 100) * (height - 8)} r={2.5} fill="currentColor" />,
          )}
        </svg>
      ) : (
        <p className="text-xs text-gray-500">One comparison so far. Compare again with the same scope to start a trend.</p>
      )}
      {score.incompatible.length > 0 && (
        <div>
          <button type="button" className="text-xs font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {score.incompatible.length} comparison{score.incompatible.length === 1 ? "" : "s"} not connected to this trend
          </button>
          {open && (
            <ul className="mt-2 space-y-1.5 text-xs text-gray-600">
              {score.incompatible.map((run) => (
                <li key={run.runId}>
                  <span className="font-medium text-gray-800">{formatDate(run.assessedAt)}, {formatPercent(run.score)}:</span> {run.reasons.join(" ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
