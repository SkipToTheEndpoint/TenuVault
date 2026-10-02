import { expect, it } from 'vitest'
import { backupCompletionUpdates } from '../src/portal/lib/backup-completion'
import { trackBackup } from '../src/renderer/lib/backups'
import type { Tenant } from '../src/portal/contexts/TenantContext'
const previous = '2026-09-20T12:00:00Z'
const endTime = '2026-09-26T12:00:00Z'
it('registers every bulk job independently without marking any complete', () => {
  const jobs: unknown[] = []
  for (const id of ['a', 'b']) trackBackup({ name: id, credentials: { tenantId: id, appId: 'app', clientSecret: 'placeholder' } } as Tenant, `job-${id}`, (job) => jobs.push(job))
  expect(jobs).toMatchObject([{ jobId: 'job-a', tenantId: 'a', isComplete: false, isSuccessful: false }, { jobId: 'job-b', tenantId: 'b', isComplete: false, isSuccessful: false }])
})
it('preserves the last successful backup until a terminal success and uses the job timestamp', () => {
  expect(backupCompletionUpdates({ isComplete: false, isSuccessful: false }, previous)).toEqual({ syncStatus: 'pending' })
  expect(backupCompletionUpdates({ isComplete: true, isSuccessful: false, endTime }, previous)).toEqual({ syncStatus: 'error', lastSync: endTime })
  expect(backupCompletionUpdates({ isComplete: true, isSuccessful: true, endTime }, previous)).toEqual({ syncStatus: 'success', lastSync: endTime, lastBackup: endTime })
})
it('does not fabricate a completion time or move a newer backup timestamp backwards', () => {
  expect(backupCompletionUpdates({ isComplete: true, isSuccessful: true }, previous)).not.toHaveProperty('lastBackup')
  expect(backupCompletionUpdates({ isComplete: true, isSuccessful: true, endTime: previous }, endTime)).not.toHaveProperty('lastBackup')
})
it('keeps the newest success and attempt when same-tenant jobs complete in reverse order', () => {
  let tenant = { lastBackup: previous, lastSync: previous, syncStatus: 'pending' }
  for (const job of [
    { isComplete: true, isSuccessful: true, endTime },
    { isComplete: true, isSuccessful: true, endTime: previous },
    { isComplete: true, isSuccessful: false, endTime: previous },
  ]) tenant = { ...tenant, ...backupCompletionUpdates(job, tenant.lastBackup, tenant.lastSync) }
  expect(tenant).toEqual({ lastBackup: endTime, lastSync: endTime, syncStatus: 'success' })
})
