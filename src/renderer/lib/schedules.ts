import { useEffect, useState } from "react"
import type { BackupRefusal, BackupSchedule } from "../../shared/ipc"
import { bridge } from "./bridge"

/** Live list of backup schedules from the main process. */
export function useSchedules(): BackupSchedule[] {
  const [schedules, setSchedules] = useState<BackupSchedule[]>([])
  useEffect(() => {
    void bridge.schedules.list().then(setSchedules)
    return bridge.schedules.onChanged(setSchedules)
  }, [])
  return schedules
}

/** Backups refused for the tenant's license, newest first, kept on this device. */
export function useRefusals(tenantId: string): BackupRefusal[] {
  const [refusals, setRefusals] = useState<BackupRefusal[]>([])
  useEffect(() => {
    const load = () => void bridge.schedules.refusals(tenantId).then(setRefusals)
    load()
    return bridge.schedules.onRefusalsChanged(load)
  }, [tenantId])
  return refusals
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export function describeSchedule(schedule: BackupSchedule): string {
  if (!schedule.enabled) return "Off"
  return schedule.frequency === "daily"
    ? `Daily at ${schedule.time}`
    : `Every ${WEEKDAYS[schedule.weekday ?? 0]} at ${schedule.time}`
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso || !Number.isFinite(new Date(iso).getTime())) return "Not scheduled"
  return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })
}
