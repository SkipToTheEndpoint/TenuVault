import { mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { LocalBlobStore } from '../src/main/storage/local-blob-store'
import { handleLocalBlobRequest } from '../src/main/storage/blob-emulator'
const account = 'tvlocal-test'
const container = 'intune-backups'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tv-inventory-')); roots.push(root)
  const key = randomBytes(32)
  const store = new LocalBlobStore(root, [key])
  await store.createContainer(account, container)
  await store.put(account, container, 'backup-test/Policies/one.json', Buffer.from('{}'), 'application/json')
  return { root, key, store, dir: join(root, account, container) }
}
it('reports wrong keys instead of an empty list through the blob API', async () => {
  const { root } = await setup()
  const response = await handleLocalBlobRequest(new LocalBlobStore(root, [randomBytes(32)]), new Request(`https://${account}.blob.core.windows.net/${container}?restype=container&comp=list`))
  expect(response.status).toBe(500)
  expect(await response.text()).toContain('1 encrypted file(s) could not be read')
})
it('rejects corrupt headers even after warming the inventory cache', async () => {
  const { store, dir } = await setup()
  expect(await store.list(account, container)).toHaveLength(1)
  writeFileSync(join(dir, readdirSync(dir)[0]!), 'corrupt')
  await expect(store.list(account, container)).rejects.toThrow('1 encrypted file(s)')
  await expect(store.get(account, container, 'backup-test/Policies/one.json')).rejects.toThrow('incomplete')
})
it('blocks reads and listings when an authenticated manifest lists a missing file', async () => {
  const { store, root, key, dir } = await setup()
  const policyFile = readdirSync(dir)[0]!
  await store.put(account, container, 'backup-test/metadata.json', Buffer.from(JSON.stringify({ Items: { 'Policies/id': { file: 'one.json', hash: 'hash' } } })), 'application/json')
  expect(await store.list(account, container)).toHaveLength(2)
  rmSync(join(dir, policyFile))
  await expect(store.get(account, container, 'backup-test/metadata.json')).rejects.toThrow('manifest are missing')
  const fresh = new LocalBlobStore(root, [key])
  await expect(fresh.get(account, container, 'backup-test/metadata.json')).rejects.toThrow('manifest are missing')
  await expect(store.list(account, container)).rejects.toThrow('manifest are missing')
})
