import type { RestoreOutcome } from "./graph-restore"

/**
 * Progress of restores that are still running, so the page can show each item as it is restored while
 * POST /api/restore-backup is in flight. The request itself still returns the full result.
 */
export interface RestoreProgress {
  total: number
  done: number
  current: string | null
  results: Array<RestoreOutcome & { targetTenantId?: string }>
  finished: boolean
  updatedAt: number
}

const KEEP_MS = 10 * 60 * 1000
const progress = new Map<string, RestoreProgress>()

export const PROGRESS_ID = /^[a-zA-Z0-9-]{8,64}$/

export function startProgress(id: string, total: number): RestoreProgress {
  for (const [key, entry] of progress) if (Date.now() - entry.updatedAt > KEEP_MS) progress.delete(key)
  const entry: RestoreProgress = { total, done: 0, current: null, results: [], finished: false, updatedAt: Date.now() }
  progress.set(id, entry)
  return entry
}

export function readProgress(id: string): RestoreProgress | undefined {
  return progress.get(id)
}
