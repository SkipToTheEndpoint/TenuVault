import { describe, expect, it, vi } from "vitest"
import { BackupScheduler } from "../src/main/backup/scheduler"
import { memoryStore } from "./helpers"

const TENANT = "11111111-1111-1111-1111-111111111111"

function setup(start: string) {
  let now = new Date(start)
  const run = vi.fn(async () => ({ status: "Completed" as const, message: "Backup completed successfully" }))
  const scheduler = new BackupScheduler(memoryStore(), run, () => undefined, () => now)
  return { scheduler, run, setNow: (iso: string) => (now = new Date(iso)) }
}

// Local times: the scheduler works in the computer's time zone.
const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).toISOString()

describe("BackupScheduler", () => {
  it("runs a daily backup once per day at the chosen time", async () => {
    const { scheduler, run, setNow } = setup(local(2026, 9, 24, 10))
    scheduler.set({ tenantId: TENANT, enabled: true, frequency: "daily", time: "02:00" })
    expect(scheduler.list()[0]!.nextRunAt).toBe(local(2026, 9, 25, 2))

    setNow(local(2026, 9, 25, 1, 59))
    await scheduler.tick()
    expect(run).not.toHaveBeenCalled()

    setNow(local(2026, 9, 25, 2, 1))
    await scheduler.tick()
    await scheduler.tick()
    expect(run).toHaveBeenCalledTimes(1)
    expect(scheduler.list()[0]).toMatchObject({ lastStatus: "Completed", nextRunAt: local(2026, 9, 26, 2) })
  })

  it("catches up a missed backup once when the app starts again", async () => {
    const { scheduler, run, setNow } = setup(local(2026, 9, 24, 10))
    scheduler.set({ tenantId: TENANT, enabled: true, frequency: "daily", time: "02:00" })
    // The computer was off for three days.
    setNow(local(2026, 9, 28, 9))
    await scheduler.tick()
    await scheduler.tick()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("does not run for slots before the schedule was created or changed", async () => {
    const { scheduler, run } = setup(local(2026, 9, 24, 10))
    scheduler.set({ tenantId: TENANT, enabled: true, frequency: "daily", time: "02:00" })
    await scheduler.tick()
    expect(run).not.toHaveBeenCalled()
  })

  it("runs weekly schedules on the chosen day", async () => {
    // 2026-09-24 is a Thursday.
    const { scheduler, run, setNow } = setup(local(2026, 9, 24, 10))
    scheduler.set({ tenantId: TENANT, enabled: true, frequency: "weekly", weekday: 1, time: "03:30" })
    expect(scheduler.list()[0]!.nextRunAt).toBe(local(2026, 9, 28, 3, 30))
    setNow(local(2026, 9, 27, 23))
    await scheduler.tick()
    expect(run).not.toHaveBeenCalled()
    setNow(local(2026, 9, 28, 3, 31))
    await scheduler.tick()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("records failures and skips disabled schedules", async () => {
    const { scheduler, run, setNow } = setup(local(2026, 9, 24, 10))
    run.mockRejectedValueOnce(new Error("Sign in again to continue."))
    scheduler.set({ tenantId: TENANT, enabled: true, frequency: "daily", time: "02:00" })
    scheduler.set({ tenantId: "22222222-2222-2222-2222-222222222222", enabled: false, frequency: "daily", time: "02:00" })
    setNow(local(2026, 9, 25, 3))
    await scheduler.tick()
    expect(run).toHaveBeenCalledTimes(1)
    expect(scheduler.list().find((s) => s.tenantId === TENANT)).toMatchObject({ lastStatus: "Failed", lastMessage: "Sign in again to continue." })
  })

  it("validates input", () => {
    const { scheduler } = setup(local(2026, 9, 24, 10))
    expect(() => scheduler.set({ tenantId: TENANT, enabled: true, frequency: "daily", time: "25:00" })).toThrow(/time/)
    expect(() => scheduler.set({ tenantId: TENANT, enabled: true, frequency: "weekly", time: "02:00" })).toThrow(/day of the week/)
  })
})
