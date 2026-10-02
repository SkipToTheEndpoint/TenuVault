import { afterEach, expect, it, vi } from 'vitest'
import { NextRequest } from '../src/main/api/next-server-shim'
import { POST as listResources } from '../src/portal/app/api/list-azure-resources/route'

const request = () => new NextRequest('http://tenuvault.internal/api/list-azure-resources', { method: 'POST', body: JSON.stringify({ tenantId: 'tenant', appId: 'app', clientSecret: 'test' }) })
afterEach(() => vi.unstubAllGlobals())

const account = (sub: string, name: string) => ({ id: `/subscriptions/${sub}/resourceGroups/rg-${name}/providers/Microsoft.Storage/storageAccounts/${name}`, name, location: 'westeurope' })

it('follows ARM nextLink for subscriptions and storage accounts', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.hostname === 'login.microsoftonline.com') return Response.json({ access_token: 'test' })
    if (url.pathname === '/subscriptions') {
      return url.searchParams.get('page') === '2'
        ? Response.json({ value: [{ subscriptionId: 's2', displayName: 'Second' }] })
        : Response.json({ value: [{ subscriptionId: 's1', displayName: 'First' }], nextLink: 'https://management.azure.com/subscriptions?api-version=2022-12-01&page=2' })
    }
    if (url.pathname === '/subscriptions/s1/providers/Microsoft.Storage/storageAccounts') {
      return url.searchParams.get('page') === '2'
        ? Response.json({ value: [account('s1', 'bravo')] })
        : Response.json({ value: [account('s1', 'charlie')], nextLink: `${url.href}&page=2` })
    }
    if (url.pathname === '/subscriptions/s2/providers/Microsoft.Storage/storageAccounts') return Response.json({ value: [account('s2', 'alpha')] })
    return new Response('', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)

  const response = await listResources(request())
  expect(response.status).toBe(200)
  const data = await response.json()
  expect(data.subscriptions.map((s: { id: string }) => s.id)).toEqual(['s1', 's2'])
  expect(data.storageAccounts.map((a: { name: string; subscriptionId: string; resourceGroup: string }) => [a.name, a.subscriptionId, a.resourceGroup])).toEqual([
    ['alpha', 's2', 'rg-alpha'],
    ['bravo', 's1', 'rg-bravo'],
    ['charlie', 's1', 'rg-charlie'],
  ])
  // Only subscriptions and storage accounts are listed; nothing the desktop app does not use.
  expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname).filter((p) => /resourcegroups$|automationAccounts$/i.test(p))).toEqual([])
})

it('reports when subscriptions cannot be listed', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
    new URL(String(input)).hostname === 'login.microsoftonline.com' ? Response.json({ access_token: 'test' }) : new Response('', { status: 403 }),
  ))
  const response = await listResources(request())
  expect(response.status).toBe(403)
})

it('retries throttled pages and skips a subscription whose listing fails', async () => {
  let throttled = false
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.hostname === 'login.microsoftonline.com') return Response.json({ access_token: 'test' })
    if (url.pathname === '/subscriptions') return Response.json({ value: [{ subscriptionId: 's1', displayName: 'First' }, { subscriptionId: 's2', displayName: 'Second' }] })
    if (url.pathname.startsWith('/subscriptions/s1/')) {
      if (!throttled) {
        throttled = true
        return new Response('', { status: 429, headers: { 'retry-after': '0' } })
      }
      return Response.json({ value: [account('s1', 'bravo')] })
    }
    throw new TypeError('fetch failed')
  }))

  const response = await listResources(request())
  expect(response.status).toBe(200)
  expect((await response.json()).storageAccounts.map((a: { name: string }) => a.name)).toEqual(['bravo'])
})
