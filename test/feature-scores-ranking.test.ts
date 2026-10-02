import { describe, expect, it } from "vitest"
import { rankGap } from "../src/main/features/scores/gap-ranking"
import { collectGaps } from "../src/main/features/scores/formula"
import { TENANT_A } from "./feature-helpers"
import { makeRun } from "./feature-scores-fixtures"

const base = makeRun({ runId: "base", tenantId: TENANT_A, at: "2026-09-20T00:00:00Z", caps: { a: ["different"], b: ["missing"], c: ["matches"] }, platformOf: { a: "tenant" } })

describe("ranking", () => {
  it("is deterministic and explains every point", () => {
    const [ca, missing] = collectGaps(base)
    const first = rankGap(ca!)
    expect(first).toEqual(rankGap(ca!))
    expect(first.level).toBe("critical")
    expect(first.reasons.join(" ")).toMatch(/Conditional Access/)
    expect(rankGap(missing!).score).toBeLessThan(first.score)
  })

  it("never raises priority for uncertain evidence, it only explains it", () => {
    const gap = collectGaps(base)[1]!
    const certain = rankGap(gap)
    const uncertain = rankGap({ ...gap, mixed: true, unknownChecks: 3 }, ["settingsCatalog: incomplete"])
    expect(uncertain.score).toBe(certain.score)
    expect(uncertain.reasons.length).toBeGreaterThan(certain.reasons.length)
  })
})
