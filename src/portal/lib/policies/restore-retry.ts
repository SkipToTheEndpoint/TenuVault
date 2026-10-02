export interface RetryOutcome {
  path: string
  success: boolean
  action?: string
  targetTenantId?: string
  retryable?: boolean
}

const key = (item: RetryOutcome) => `${item.targetTenantId?.toLowerCase() ?? ''}\n${item.path}`

/** Retry only confirmed failures in their original target, never successful copies. */
export function retryBatches(outcomes: RetryOutcome[]): Array<{ targetTenantId?: string; paths: string[] }> {
  const groups = new Map<string, { targetTenantId?: string; paths: string[] }>()
  for (const outcome of outcomes) {
    if (outcome.success || outcome.action === 'skipped' || outcome.retryable === false) continue
    const tenant = outcome.targetTenantId?.toLowerCase() ?? ''
    const group = groups.get(tenant) ?? { ...(tenant ? { targetTenantId: tenant } : {}), paths: [] }
    if (!group.paths.includes(outcome.path)) group.paths.push(outcome.path)
    groups.set(tenant, group)
  }
  return [...groups.values()]
}

export function mergeOutcomes<T extends RetryOutcome>(previous: T[], updates: T[]): T[] {
  const merged = new Map(previous.map((item) => [key(item), item]))
  for (const item of updates) merged.set(key(item), item)
  return [...merged.values()]
}
