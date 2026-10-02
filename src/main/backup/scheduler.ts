import type { BackupSchedule, ScheduleInput } from "../../shared/ipc"
import type { KeyValueStore } from "../storage/secure-store"

const KEY = "backup.schedules"
const TICK_MS = 60 * 1000

export interface ScheduledRunResult {
  status: "Completed" | "Failed"
  message: string
}

/**
 * Runs backups on a schedule while TenuVault is running (in the window or the tray).
 * No Azure resources are involved: backups run in the app as the signed-in admin.
 *
 * A schedule is due when its most recent slot (for example today 02:00) has passed and
 * the backup has not run since that slot. Slots missed while the app was closed are
 * caught up once when it starts. Backups run one at a time.
 */
export class BackupScheduler {
  private timer: NodeJS.Timeout | null = null
  private running: Promise<void> | null = null

  constructor(
    private readonly store: KeyValueStore,
    private readonly run: (tenantId: string) => Promise<ScheduledRunResult>,
    private readonly onChange: () => void = () => undefined,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): BackupSchedule[] {
    return Object.values(this.read()).map((schedule) => ({ ...schedule, nextRunAt: this.nextRun(schedule)?.toISOString() ?? null }))
  }

  set(input: ScheduleInput): BackupSchedule {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new Error("Choose a time such as 02:00.")
    if (input.frequency === "weekly" && (input.weekday === undefined || input.weekday < 0 || input.weekday > 6)) {
      throw new Error("Choose a day of the week.")
    }
    const all = this.read()
    const id = input.tenantId.toLowerCase()
    const previous = all[id]
    all[id] = {
      tenantId: id,
      enabled: input.enabled,
      frequency: input.frequency,
      time: input.time,
      weekday: input.frequency === "weekly" ? input.weekday : undefined,
      // Changing a schedule does not trigger a catch-up run for slots before the change.
      since: this.now().toISOString(),
      lastRunAt: previous?.lastRunAt,
      lastStatus: previous?.lastStatus,
      lastMessage: previous?.lastMessage,
      nextRunAt: null,
    }
    this.write(all)
    return this.list().find((s) => s.tenantId === id)!
  }

  remove(tenantId: string): void {
    const all = this.read()
    delete all[tenantId.toLowerCase()]
    this.write(all)
  }

  hasEnabled(): boolean {
    return Object.values(this.read()).some((s) => s.enabled)
  }

  /** The next scheduled backup across all tenants. */
  next(): { tenantId: string; at: Date } | null {
    let best: { tenantId: string; at: Date } | null = null
    for (const schedule of Object.values(this.read())) {
      const at = this.nextRun(schedule)
      if (at && (!best || at < best.at)) best = { tenantId: schedule.tenantId, at }
    }
    return best
  }

  start(): void {
    if (this.timer) return
    // Give sign-in caches and the window a moment before catching up missed backups.
    setTimeout(() => void this.tick(), 30 * 1000)
    this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Runs every due backup, one after another. Returns when they are done. */
  tick(): Promise<void> {
    if (this.running) return this.running
    this.running = (async () => {
      for (const schedule of Object.values(this.read())) {
        if (!this.isDue(schedule)) continue
        const result = await this.run(schedule.tenantId).catch((error: unknown) => ({
          status: "Failed" as const,
          message: error instanceof Error ? error.message : String(error),
        }))
        const all = this.read()
        const current = all[schedule.tenantId]
        if (current) {
          all[schedule.tenantId] = { ...current, lastRunAt: this.now().toISOString(), lastStatus: result.status, lastMessage: result.message }
          this.write(all)
        }
      }
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  isDue(schedule: BackupSchedule): boolean {
    if (!schedule.enabled) return false
    const slot = this.lastSlot(schedule)
    const since = Date.parse(schedule.since)
    const lastRun = schedule.lastRunAt ? Date.parse(schedule.lastRunAt) : 0
    return slot.getTime() > since && slot.getTime() > lastRun
  }

  nextRun(schedule: BackupSchedule): Date | null {
    if (!schedule.enabled) return null
    if (this.isDue(schedule)) return this.now()
    const next = this.slotOn(schedule, this.now())
    while (next <= this.now()) next.setDate(next.getDate() + (schedule.frequency === "weekly" ? 7 : 1))
    return next
  }

  /** The most recent slot at or before now, in local time. */
  private lastSlot(schedule: BackupSchedule): Date {
    const slot = this.slotOn(schedule, this.now())
    while (slot > this.now()) slot.setDate(slot.getDate() - (schedule.frequency === "weekly" ? 7 : 1))
    return slot
  }

  /** The slot in the week (weekly) or on the day (daily) of `reference`. */
  private slotOn(schedule: BackupSchedule, reference: Date): Date {
    const [hours, minutes] = schedule.time.split(":").map(Number) as [number, number]
    const slot = new Date(reference)
    slot.setHours(hours, minutes, 0, 0)
    if (schedule.frequency === "weekly") slot.setDate(slot.getDate() + ((schedule.weekday ?? 0) - slot.getDay()))
    return slot
  }

  private read(): Record<string, BackupSchedule> {
    try {
      const parsed: unknown = JSON.parse(this.store.get(KEY) ?? "{}")
      return parsed && typeof parsed === "object" ? (parsed as Record<string, BackupSchedule>) : {}
    } catch {
      return {}
    }
  }

  private write(all: Record<string, BackupSchedule>): void {
    this.store.set(KEY, JSON.stringify(all))
    this.onChange()
  }
}
