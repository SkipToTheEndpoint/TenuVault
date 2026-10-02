import { describe, expect, it } from "vitest"
import { featureRoute, FeatureError } from "../src/main/features/route"
import { MAX_REVISIONS, resolveHistory, SHARED_SCOPE } from "../src/main/features/records"
import { featureRouteFeatures, FEATURE_ROUTES } from "../src/shared/feature-routes"
import { planGuard, requiredFeatures } from "../src/main/api/plan-gates"
import { call, fakeDeps, TENANT_A, TENANT_B, TENANT_C } from "./feature-helpers"

describe("feature route gates", () => {
  it("keeps stored-record reads free and gates everything else", () => {
    expect(featureRouteFeatures("/api/hygiene", "list")).toEqual([])
    expect(featureRouteFeatures("/api/hygiene", "get-finding")).toEqual([])
    expect(featureRouteFeatures("/api/hygiene", "acknowledge")).toEqual(["hygieneExplorer"])
    expect(featureRouteFeatures("/api/standards", "standard-create")).toEqual(["goldenStandards"])
    expect(featureRouteFeatures("/api/health-review", "portfolio-status")).toEqual(["healthReview", "portfolio"])
    expect(requiredFeatures("/api/scores", { action: "compute" })).toEqual(["baselineScores"])
  })

  it("answers 400 without a tenant and 402 for Community on every roadmap route", async () => {
    const guard = planGuard(async () => "community")
    for (const path of Object.keys(FEATURE_ROUTES)) {
      const post = (body: unknown) => guard(new Request(`http://tenuvault.internal${path}`, { method: "POST", body: JSON.stringify(body) }))
      expect((await post({ action: "run" }))?.status).toBe(400)
      expect((await post({ tenantId: TENANT_A, action: "run" }))?.status).toBe(402)
      expect(await post({ tenantId: TENANT_A, action: "list" })).toBeNull()
    }
  })
})

describe("featureRoute", () => {
  const handlers = {
    list: () => ({ items: [] }),
    compute: () => ({ ok: true }),
    "portfolio-summary": ({ targetTenants }: { targetTenants: string[] }) => ({ targetTenants }),
    fail: () => { throw new FeatureError("Nope", 409) },
  }

  it("checks the plan again inside the route", async () => {
    const deps = fakeDeps({ plans: { [TENANT_A]: "community" } })
    const routes = featureRoute("/api/scores", deps, handlers)
    expect((await call(routes, "/api/scores", { tenantId: TENANT_A, action: "compute" })).status).toBe(402)
    expect((await call(routes, "/api/scores", { tenantId: TENANT_A, action: "list" })).status).toBe(200)
    expect((await call(routes, "/api/scores", { tenantId: "x", action: "list" })).status).toBe(400)
    expect((await call(routes, "/api/scores", { tenantId: TENANT_A, action: "nope" })).status).toBe(400)
  })

  it("requires every portfolio target to be connected and on MSP", async () => {
    const deps = fakeDeps({ plans: { [TENANT_A]: "msp", [TENANT_B]: "msp", [TENANT_C]: "pro" } })
    const routes = featureRoute("/api/scores", deps, handlers)
    const ok = await call(routes, "/api/scores", { tenantId: TENANT_A, action: "portfolio-summary", targetTenants: [{ tenantId: TENANT_B }] })
    expect(ok.body.targetTenants).toEqual([TENANT_B])
    expect((await call(routes, "/api/scores", { tenantId: TENANT_A, action: "portfolio-summary", targetTenants: [{ tenantId: TENANT_C }] })).status).toBe(402)
    expect((await call(routes, "/api/scores", { tenantId: TENANT_A, action: "portfolio-summary", targetTenants: [{ tenantId: "44444444-4444-4444-4444-444444444444" }] })).status).toBe(403)
  })

  it("maps FeatureError to its status", async () => {
    const routes = featureRoute("/api/scores", fakeDeps(), handlers)
    expect(await call(routes, "/api/scores", { tenantId: TENANT_A, action: "fail" })).toEqual({ status: 409, body: { error: "Nope" } })
  })
})

describe("TenantRecords", () => {
  it("isolates tenants and appends history on update", () => {
    const { records } = fakeDeps()
    const created = records.create<{ title: string }>("hygiene-findings", TENANT_A, { title: "One" }, { actor: "Admin", reason: "created" })
    expect(records.list("hygiene-findings", TENANT_B)).toEqual([])
    expect(records.get("hygiene-findings", TENANT_B, created.id)).toBeNull()
    const updated = records.update<{ title: string }>("hygiene-findings", TENANT_A, created.id, (current) => ({ ...current, title: "Two" }), { actor: "Admin", reason: "renamed" })
    expect(updated?.title).toBe("Two")
    expect(updated?.history.map((entry) => entry.reason)).toEqual(["created", "renamed"])
    expect(updated?.history[0]?.snapshot.title).toBe("One")
    expect(() => records.list("Bad Domain", TENANT_A)).toThrow()
    expect(records.list("standards", SHARED_SCOPE)).toEqual([])
  })

  it("stores only the changed fields per revision and still resolves every earlier state", () => {
    const deps = fakeDeps()
    const { records, store } = deps
    type Doc = { title: string; body: string; note?: string }
    const body = "x".repeat(50_000)
    const created = records.create<Doc>("change-sets", TENANT_A, { title: "One", body, note: "draft" }, { actor: "Admin", reason: "created" })
    for (let index = 0; index < 20; index++) records.update<Doc>("change-sets", TENANT_A, created.id, (current) => ({ ...current, title: `Title ${index}` }), { actor: null, reason: `progress ${index}` })
    const cleared = records.update<Doc>("change-sets", TENANT_A, created.id, ({ note: _note, ...current }) => current, { actor: "Admin", reason: "cleared the note" })!
    // The large field is stored once in the record and once in the first revision, not per update.
    expect(store.get(`records.v1.change-sets.${TENANT_A}`)!.length).toBeLessThan(3 * body.length)
    expect(cleared.history[1]?.snapshot).toEqual({ title: "Title 0" })
    expect(cleared.history.at(-1)).toMatchObject({ partial: true, removed: ["note"] })
    const resolved = resolveHistory(cleared.history)
    expect(resolved[0]?.snapshot).toMatchObject({ title: "One", body, note: "draft" })
    expect(resolved[20]?.snapshot).toMatchObject({ title: "Title 19", body, note: "draft" })
    expect(resolved.at(-1)?.snapshot).toEqual((({ history: _history, ...plain }) => plain)(cleared))
    expect("note" in resolved.at(-1)!.snapshot).toBe(false)
  })

  it("keeps complete revisions written before partial ones and trims history to a resolvable start", () => {
    const { records, store } = fakeDeps()
    const created = records.create<{ count: number }>("change-sets", TENANT_A, { count: 0 }, { actor: null, reason: "created" })
    // A record from an earlier version: every revision holds the whole record.
    const key = `records.v1.change-sets.${TENANT_A}`
    const legacy = JSON.parse(store.get(key)!)
    legacy[0].count = 1
    legacy[0].history.push({ at: "2026-09-30T12:00:00.000Z", actor: null, reason: "legacy", snapshot: { ...created, history: undefined, count: 1 } })
    store.set(key, JSON.stringify(legacy))
    let latest = records.get<{ count: number }>("change-sets", TENANT_A, created.id)!
    for (let count = 2; count <= MAX_REVISIONS + 5; count++) latest = records.update<{ count: number }>("change-sets", TENANT_A, created.id, (current) => ({ ...current, count }), { actor: null, reason: `count ${count}` })!
    expect(latest.history).toHaveLength(MAX_REVISIONS)
    expect(latest.history[0]?.partial).toBeUndefined()
    const resolved = resolveHistory(latest.history)
    expect(resolved.map((revision) => revision.snapshot.count)).toEqual(Array.from({ length: MAX_REVISIONS }, (_, index) => index + 6))
    expect(resolved[0]?.snapshot.id).toBe(created.id)
  })
})
