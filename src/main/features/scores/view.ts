import type { NativeAssessment } from "../../../shared/compliance/native"
import type { ControlStatus } from "../../../shared/compliance/types"
import { rankGap, type Ranking } from "./gap-ranking"
import type { HistoryRead } from "./history"
import {
  buildTrend,
  collectGaps,
  freshness,
  identityOf,
  incompleteCollection,
  scoreRun,
  type AssessmentIdentity,
  type BaselineScore,
  type Freshness,
  type Gap,
  type IncompatibleRun,
  type TrendPoint,
} from "./formula"

/** Pure projections of saved comparisons into what the scores screen shows. */

export interface RankedGap extends Gap {
  ranking: Ranking
}

export interface LatestScore {
  identity: AssessmentIdentity
  freshness: Freshness
  score: BaselineScore
  /** Collection families that were not fully read; non-empty means partial evidence. */
  incompleteCollection: string[]
  gapCount: number
  topGaps: RankedGap[]
}

export interface FrameworkScore {
  frameworkId: string
  frameworkName: string
  /** not-assessed: no saved comparison. unavailable: the saved comparisons could not be read. */
  state: "scored" | "not-scored" | "not-assessed" | "unavailable"
  message: string | null
  latest: LatestScore | null
  trend: TrendPoint[]
  incompatible: IncompatibleRun[]
}

const TOP_GAPS = 5

/** Gaps of a run ranked by the documented gap criteria (gap-ranking.ts), highest first. */
export function rankedGaps(run: NativeAssessment): RankedGap[] {
  const incomplete = incompleteCollection(run)
  return collectGaps(run)
    .map((gap) => ({ ...gap, ranking: rankGap(gap, incomplete) }))
    .sort((a, b) => b.ranking.score - a.ranking.score || a.capabilityName.localeCompare(b.capabilityName))
}

export function latestScore(run: NativeAssessment, now: Date, topGaps = TOP_GAPS): LatestScore {
  const gaps = rankedGaps(run)
  return {
    identity: identityOf(run),
    freshness: freshness(run, now),
    score: scoreRun(run),
    incompleteCollection: incompleteCollection(run),
    gapCount: gaps.length,
    topGaps: gaps.slice(0, topGaps),
  }
}

function newest(runs: NativeAssessment[]): NativeAssessment | undefined {
  return [...runs].sort((a, b) => Date.parse(identityOf(b).assessedAt) - Date.parse(identityOf(a).assessedAt))[0]
}

/** One framework's score card from its saved history. */
export function frameworkScore(read: HistoryRead, now: Date): FrameworkScore {
  const base = { frameworkId: read.frameworkId, frameworkName: read.frameworkName }
  if (read.status === "unavailable") return { ...base, state: "unavailable", message: read.error, latest: null, trend: [], incompatible: [] }
  const run = newest(read.runs)
  if (!run) return { ...base, state: "not-assessed", message: read.notice ?? "No saved comparison. Compare this framework on the Frameworks page first.", latest: null, trend: [], incompatible: [] }
  const latest = latestScore(run, now)
  const { trend, incompatible } = buildTrend(read.runs)
  return { ...base, frameworkName: latest.identity.frameworkName || read.frameworkName, state: latest.score.state, message: latest.score.reason ?? read.notice, latest, trend, incompatible }
}

export interface ControlRow {
  id: string
  title: string
  status: ControlStatus
  capabilityIds: string[]
  gapCapabilityIds: string[]
  unavailable: string | null
}

export interface FrameworkDetail {
  identity: AssessmentIdentity
  freshness: Freshness
  score: BaselineScore
  incompleteCollection: string[]
  gaps: RankedGap[]
  controls: ControlRow[]
  unassessedNote: string | null
}

/** Drill-down of one saved comparison to its source controls and every gap. */
export function frameworkDetail(run: NativeAssessment, now: Date): FrameworkDetail {
  const gaps = rankedGaps(run)
  const gapIds = new Set(gaps.map((gap) => gap.capabilityId))
  const framework = run.assessment.frameworks[0]
  return {
    identity: identityOf(run),
    freshness: freshness(run, now),
    score: scoreRun(run),
    incompleteCollection: incompleteCollection(run),
    gaps,
    controls: (framework?.controls ?? []).map((control) => ({
      id: control.control.id,
      title: control.control.title,
      status: control.status,
      capabilityIds: control.capabilityIds,
      gapCapabilityIds: control.capabilityIds.filter((id) => gapIds.has(id)),
      unavailable: control.unavailableCheck ? (control.unavailableCheck.reason ?? "No configuration check exists for this requirement.") : null,
    })),
    unassessedNote: framework?.framework.note ?? null,
  }
}
