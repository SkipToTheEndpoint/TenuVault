export type BackupState = 'success' | 'failed' | 'partial' | 'running' | 'incomplete' | 'unknown'
export function normalizeBackupStatus(backup: { status?: unknown; properties?: { status?: unknown }; result?: unknown }): BackupState {
  const raw = [backup.status, backup.properties?.status, backup.result].find((value) => typeof value === 'string' && value.trim().length > 0)
  switch (typeof raw === 'string' ? raw.trim().toLowerCase() : '') {
    case 'success': case 'succeeded': case 'completed': return 'success'
    case 'failed': case 'error': return 'failed'
    case 'partial': case 'partiallycompleted': case 'completedwithwarnings': case 'warning': return 'partial'
    case 'running': case 'inprogress': case 'queued': return 'running'
    case 'incomplete': return 'incomplete'
    default: return 'unknown'
  }
}
interface Backup { status: BackupState; timestamp: Date }
export function latestComplete<T extends Backup>(backups: T[]): T | null {
  return backups.filter((item) => item.status === 'success' && Number.isFinite(item.timestamp.getTime()))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0] ?? null
}
export function backupHealth(backups: Backup[], now: Date, unavailable = false): 'healthy' | 'warning' | 'critical' {
  if (unavailable) return 'warning'
  const latest = latestComplete(backups)
  if (!latest) return backups.some((item) => ['failed', 'partial', 'incomplete'].includes(item.status)) ? 'critical' : 'warning'
  const age = (now.getTime() - latest.timestamp.getTime()) / 3_600_000
  if (age < 0) return 'warning'
  return age < 24 ? 'healthy' : age < 48 ? 'warning' : 'critical'
}
export function backupCounts(backups: Backup[]) {
  const successful = backups.filter((item) => item.status === 'success').length
  const failed = backups.filter((item) => ['failed', 'partial', 'incomplete'].includes(item.status)).length
  return { successful, failed, inProgress: backups.filter((item) => item.status === 'running').length,
    successRate: successful + failed ? successful / (successful + failed) * 100 : 0 }
}
