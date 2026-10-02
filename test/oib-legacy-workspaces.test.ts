import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setNativeFrameworkAuthorization } from '../src/main/frameworks/native'
import { handleFramework, type ExportFile } from '../src/main/frameworks/service'
import { loadWorkspace, recordAssessment, setFrameworkStore, type FrameworkWorkspace } from '../src/main/frameworks/workspaces'
import type { Assessment, BaselinePolicy, RecordJson } from '../src/shared/frameworks/policies'

// OIB left the frameworks catalog; its saved pack comparisons stay readable and exportable only.
const TENANT = '11111111-1111-1111-1111-111111111111'
const OTHER = '33333333-3333-3333-3333-333333333333'
const APP = '22222222-2222-2222-2222-222222222222'
const policy: BaselinePolicy = {
  name: 'Win - OIB - Defender', platforms: 'windows10', technologies: 'mdm', description: '',
  settings: [{ settingInstance: { '@odata.type': '#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance', settingDefinitionId: 'defender_scan', simpleSettingValue: { value: 1 } } }],
}
const assessment: Assessment = {
  runId: 'oib-run', tenantId: TENANT, frameworkId: 'oib', reference: 'Windows v3.8', assessedAt: '2026-05-01T10:00:00Z', policyCount: 4,
  findings: [{ key: '0:0', policyIndex: 0, settingIndex: 0, policyName: 'Win - OIB - Defender', settingId: 'defender_scan', status: 'Missing', recommended: { value: 1 }, observed: [] }],
  organizationalEvidence: { state: 'manual', note: 'Organizational controls require a separate assessment.' },
}
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  const values = new Map<string, string>()
  setFrameworkStore({ get: k => values.get(k) ?? null, set: (k, v) => { values.set(k, v) }, delete: k => { values.delete(k) } })
  setNativeFrameworkAuthorization(async () => 'community')
  recordAssessment(assessment, [policy])
  fetchMock = vi.fn(async () => { throw new Error('No network for saved OIB comparisons') })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

it('loads the saved OIB history read-only', async () => {
  const workspace = await handleFramework({ action: 'workspace-load', tenantId: TENANT, frameworkId: 'oib' }) as FrameworkWorkspace
  expect(workspace.history).toHaveLength(1)
  expect(workspace.history[0]!.assessment).toMatchObject({ runId: 'oib-run', reference: 'Windows v3.8', findings: [{ status: 'Missing' }] })
})

it('exports a saved OIB comparison as JSON, CSV and PDF on Community without network access', async () => {
  const request = (action: string, extra: object = {}) => handleFramework({ action, tenantId: TENANT, frameworkId: 'oib', tenantName: 'Contoso', ...extra }) as Promise<{ file: ExportFile }>
  const csv = (await request('workspace-csv', { runId: 'oib-run' })).file
  expect(csv.name).toBe('framework-oib-oib-run.csv')
  expect(csv.data).toContain('Windows v3.8')
  expect(csv.data).toContain('OpenIntuneBaseline')
  expect(JSON.parse((await request('workspace-json', { runId: 'oib-run' })).file.data).result.assessment.findings[0].key).toBe('0:0')
  expect(JSON.parse((await request('workspace-json')).file.data).assessments).toHaveLength(1)
  const pdf = (await request('workspace-pdf', { runId: 'oib-run' })).file
  expect(Buffer.from(pdf.data, 'base64').subarray(0, 5).toString()).toBe('%PDF-')
  expect(fetchMock).not.toHaveBeenCalled()
})

it.each([
  { action: 'assess', appId: APP, reference: 'Windows v3.8', policies: [policy] },
  { action: 'create', appId: APP, runId: 'oib-run', keys: ['0:0'], confirmUnassigned: true },
  { action: 'workspace-save', reference: 'Windows v3.9', policies: [policy] },
  { action: 'workspace-delete' },
  { action: 'workspace-delete-assessment', runId: 'oib-run' },
])('refuses $action for the legacy OIB pack before any network or storage change', async body => {
  await expect(handleFramework({ tenantId: TENANT, frameworkId: 'oib', ...body } as unknown as RecordJson)).rejects.toMatchObject({ status: 403, message: expect.stringContaining('read-only') })
  expect(fetchMock).not.toHaveBeenCalled()
  expect(loadWorkspace(TENANT, 'oib')).toMatchObject({ reference: 'Windows v3.8', history: [{ assessment: { runId: 'oib-run' } }] })
})

it('does not authorize creation from a saved OIB run without a framework ID', async () => {
  fetchMock.mockImplementation(async () => Response.json({ access_token: 'test' }))
  await expect(handleFramework({ action: 'create', tenantId: TENANT, appId: APP, runId: 'oib-run', keys: ['0:0'], confirmUnassigned: true })).rejects.toThrow('expired')
  expect(fetchMock.mock.calls.every(([url]) => String(url).includes('oauth2'))).toBe(true)
})

it('keeps saved OIB comparisons isolated per tenant', async () => {
  const other = await handleFramework({ action: 'workspace-load', tenantId: OTHER, frameworkId: 'oib' }) as FrameworkWorkspace
  expect(other.history).toEqual([])
  await expect(handleFramework({ action: 'workspace-json', tenantId: OTHER, frameworkId: 'oib', runId: 'oib-run' })).rejects.toMatchObject({ status: 404 })
  await expect(handleFramework({ action: 'workspace-json', tenantId: OTHER, frameworkId: 'oib' })).rejects.toMatchObject({ status: 404 })
})
