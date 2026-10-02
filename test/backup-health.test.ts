import { expect, it } from 'vitest'
import { backupCounts, backupHealth, latestComplete, normalizeBackupStatus } from '../src/portal/lib/backup-health'
const now = new Date('2026-09-26T12:00:00Z')
it.each(['running', 'incomplete', 'unknown', 'failed', 'partial', 'success'] as const)('preserves %s', (status) => {
  expect(normalizeBackupStatus({ status })).toBe(status)
})
it('requires an explicit completed status and counts only terminal results in success rate', () => {
  expect(normalizeBackupStatus({ status: 'Completed' })).toBe('success')
  expect(normalizeBackupStatus({ status: 'CompletedWithWarnings' })).toBe('partial')
  expect(normalizeBackupStatus({ status: 'new-server-state' })).toBe('unknown')
  expect(backupCounts(['running', 'incomplete', 'unknown', 'failed', 'partial', 'success'].map((status) => ({ status: normalizeBackupStatus({ status }), timestamp: now })))).toEqual({ successful: 1, failed: 3, inProgress: 1, successRate: 25 })
})
it('does not let a recent failed backup hide stale protection', () => {
  const backups = [{ status: 'failed' as const, timestamp: now }, { status: 'success' as const, timestamp: new Date(now.getTime() - 72 * 3_600_000) }]
  expect(latestComplete(backups)).toBe(backups[1])
  expect(backupHealth(backups, now)).toBe('critical')
})
it('never labels empty, unknown, unavailable or unfinished protection healthy', () => {
  expect(backupHealth([], now)).toBe('warning')
  for (const status of ['running', 'unknown', 'incomplete', 'failed', 'partial'] as const) expect(backupHealth([{ status, timestamp: now }], now)).not.toBe('healthy')
  expect(backupHealth([{ status: 'success', timestamp: now }], now, true)).toBe('warning')
  expect(backupHealth([{ status: 'success', timestamp: now }], now)).toBe('healthy')
})

it('skips blank status fields and trims meaningful fallback states', () => {
  expect(normalizeBackupStatus({ status: '', properties: { status: ' Completed ' } })).toBe('success')
  expect(normalizeBackupStatus({ status: '  ', properties: { status: '' }, result: 'Succeeded' })).toBe('success')
  expect(normalizeBackupStatus({ status: '  ' })).toBe('unknown')
})
