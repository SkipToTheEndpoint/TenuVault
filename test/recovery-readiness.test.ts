import { expect, it, vi } from 'vitest'
import { recoveryReadiness, parseDependencyMappings, reviewedDependencyMappings } from '../src/shared/intune/recovery'
import { typeForFolder } from '../src/shared/intune/registry'
import { Restorer } from '../src/portal/lib/policies/graph-restore'
const sourceId = '11111111-1111-1111-1111-111111111111', targetId = '22222222-2222-2222-2222-222222222222'
it('separates installer recovery and manual targeting from automatic configuration', () => {
  const app = recoveryReadiness(typeForFolder('Apps')!, { id: sourceId, displayName: 'Installer', '@odata.type': '#microsoft.graph.win32LobApp', assignments: [{ target: { groupId: sourceId } }] })
  expect(app.automatic).toBe(false)
  expect(app.externalArtifacts).toHaveLength(1)
  expect(app.manualActions.join(' ')).toContain('unassigned')
  expect(recoveryReadiness(typeForFolder('AppCategories')!, { id: sourceId, displayName: 'Category' }).automatic).toBe(true)
})
it('rejects unsupported and duplicate mappings', () => {
  expect(() => parseDependencyMappings([{ folder: 'Groups', sourceId, targetId }])).toThrow('supported folder')
  expect(() => parseDependencyMappings([{ folder: 'Apps', sourceId, targetId }, { folder: 'Apps', sourceId, targetId }])).toThrow('unique source')
})
it('validates every target mapping before any writes and rejects unavailable objects', async () => {
  const graph = vi.fn(async () => ({ status: 404, body: {} }))
  const restorer = new Restorer(graph, { mode: 'copy', assignments: false, crossTenant: true })
  await expect(restorer.mapDependencies([{ folder: 'Apps', sourceId, targetId }])).rejects.toThrow('missing or unreadable')
  expect(graph).toHaveBeenCalledWith('GET', `deviceAppManagement/mobileApps/${targetId}`)
  expect(graph.mock.calls).toHaveLength(1)
})
it('uses reviewed target category IDs instead of source IDs in copied app references', async () => {
  const writes: unknown[] = []
  const graph = vi.fn(async (method: string, _path: string, body?: unknown) => {
    if (method === 'GET') return { status: 200, body: { id: targetId } }
    writes.push(body); return { status: 201, body: { id: 'created-app' } }
  })
  const restorer = new Restorer(graph, { mode: 'copy', assignments: false, crossTenant: true })
  await restorer.mapDependencies([{ folder: 'AppCategories', sourceId, targetId }])
  const result = await restorer.restore('backup-1/Apps/Web.json', { id: 'old-app', displayName: 'Web', '@odata.type': '#microsoft.graph.webApp', appUrl: 'https://example.com', categories: [{ id: sourceId }] })
  expect(result.success).toBe(true)
  expect(JSON.stringify(writes)).toContain(targetId)
  expect(JSON.stringify(writes)).not.toContain(sourceId)
})

it('validates mapping input and confirmation before a restore starts', () => {
  expect(() => reviewedDependencyMappings('{', true, 1)).toThrow('valid JSON')
  const json = JSON.stringify([{ folder: 'Apps', sourceId, targetId }])
  expect(() => reviewedDependencyMappings(json, false, 1)).toThrow('Confirm')
  expect(() => reviewedDependencyMappings(json, true, 2)).toThrow('exactly one')
  expect(reviewedDependencyMappings(json, true, 1)).toHaveLength(1)
})
it('preserves reviewed mappings across source copies and leaves unrelated text intact', async () => {
  const source = 'aabbccdd-1111-1111-1111-111111111111'
  const writes: unknown[] = []
  const graph = vi.fn(async (method: string, _path: string, body?: unknown) => {
    if (method === 'GET') return { status: 200, body: { id: targetId } }
    writes.push(body); return { status: 201, body: { id: 'new-copy-id' } }
  })
  const restorer = new Restorer(graph, { mode: 'copy', assignments: false, crossTenant: true })
  await restorer.mapDependencies([{ folder: 'AppCategories', sourceId: source.toUpperCase(), targetId }])
  await restorer.restore('backup/AppCategories/Category.json', { id: source, displayName: 'Category' })
  const result = await restorer.restore('backup/Apps/Web.json', { id: 'app', displayName: 'Web', '@odata.type': '#microsoft.graph.webApp', appUrl: `https://example.com/${source}`, categories: [{ id: source }] })
  expect(result.success).toBe(true)
  expect(writes).toContainEqual(expect.objectContaining({ appUrl: `https://example.com/${source}` }))
  expect(writes).toContainEqual({ '@odata.id': `https://graph.microsoft.com/beta/deviceAppManagement/mobileAppCategories/${targetId}` })
})
