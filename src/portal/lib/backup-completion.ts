interface CompletedJob {
  isComplete: boolean
  isSuccessful: boolean
  endTime?: string
}
/** Only terminal, successful jobs advance the protection timestamp. */
export function backupCompletionUpdates(job: CompletedJob, previousBackup: string, previousSync?: string) {
  if (!job.isComplete) return { syncStatus: 'pending' }
  const end = job.endTime && Number.isFinite(Date.parse(job.endTime)) ? job.endTime : undefined
  const newer = end && (!Number.isFinite(Date.parse(previousBackup)) || Date.parse(end) > Date.parse(previousBackup))
  const latestAttempt = end && (!previousSync || !Number.isFinite(Date.parse(previousSync)) || Date.parse(end) >= Date.parse(previousSync))
  return { ...(latestAttempt || !previousSync ? { syncStatus: job.isSuccessful ? 'success' : 'error' } : {}),
    ...(job.isSuccessful && newer ? { lastBackup: end } : {}),
    ...(latestAttempt ? { lastSync: end } : {}) }
}
