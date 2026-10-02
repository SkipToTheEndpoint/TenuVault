import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { backupRoutes } from "../src/main/api/desktop-routes"
import { createBridgedFetch } from "../src/main/api/fetch-bridge"
import { ApiHost, routesFromGlob } from "../src/main/api/host"
import { BackupEngine, verifyStorageAccess } from "../src/main/backup/engine"
import { handleLocalBlobRequest } from "../src/main/storage/blob-emulator"
import { LocalBlobStore } from "../src/main/storage/local-blob-store"
import { DELEGATED_CLIENT_SECRET, localStorageAccountName } from "../src/shared/constants"

/**
 * Read-only end-to-end run of the shared API routes against a real tenant, through
 * the same API host and token bridge the desktop main process uses.
 *
 * The renderer sends DELEGATED_CLIENT_SECRET like a desktop tenant profile does. In
 * the app the bridge answers with the signed-in admin's MSAL token; here it answers
 * with an app-only token for the E2E app registration, since tests cannot sign in
 * interactively.
 *
 *   TENUVAULT_E2E_TENANT_ID=... TENUVAULT_E2E_CLIENT_ID=... TENUVAULT_E2E_CLIENT_SECRET=... \
 *   TENUVAULT_E2E_SUBSCRIPTION_ID=... TENUVAULT_E2E_RESOURCE_GROUP=... \
 *   TENUVAULT_E2E_STORAGE_ACCOUNT=... npm run test:e2e
 *
 * TENUVAULT_E2E_STORAGE_WRITE=1 also backs up the tenant to that storage account and reads it back.
 * Use an empty account reserved for this test: the backup writes to its intune-backups container.
 */

const env = {
  tenantId: process.env.TENUVAULT_E2E_TENANT_ID ?? "",
  clientId: process.env.TENUVAULT_E2E_CLIENT_ID ?? "",
  clientSecret: process.env.TENUVAULT_E2E_CLIENT_SECRET ?? "",
  subscriptionId: process.env.TENUVAULT_E2E_SUBSCRIPTION_ID ?? "",
  resourceGroupName: process.env.TENUVAULT_E2E_RESOURCE_GROUP ?? "",
  storageAccountName: process.env.TENUVAULT_E2E_STORAGE_ACCOUNT ?? "",
  storageWrite: process.env.TENUVAULT_E2E_STORAGE_WRITE === "1",
}

const configured = Boolean(env.tenantId && env.clientId && env.clientSecret)

describe.skipIf(!configured)("lab tenant end-to-end (read-only)", () => {
  const originalFetch = globalThis.fetch
  const tokenRequests: string[] = []
  let host: ApiHost
  let bridged: typeof fetch
  const localStore = new LocalBlobStore(mkdtempSync(join(tmpdir(), "tv-lab-backups-")), [randomBytes(32)])
  const localAccount = localStorageAccountName(env.tenantId)

  /** App-only token for the E2E app registration; stands in for the admin's MSAL token (cached like MSAL does). */
  const tokens = new Map<string, Promise<string>>()
  function appToken(scope: string): Promise<string> {
    let token = tokens.get(scope)
    if (!token) {
      token = requestAppToken(scope)
      tokens.set(scope, token)
      token.catch(() => tokens.delete(scope))
    }
    return token
  }
  async function requestAppToken(scope: string): Promise<string> {
    const response = await originalFetch(`https://login.microsoftonline.com/${env.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      body: new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, scope, grant_type: "client_credentials" }),
    })
    const token = (await response.json()) as { access_token?: string; error_description?: string }
    if (!token.access_token) throw new Error(token.error_description ?? "token request failed")
    return token.access_token
  }

  beforeAll(() => {
    const routes = routesFromGlob(
      import.meta.glob("../src/portal/app/api/**/route.ts", { eager: true }),
    )
    const engine = new BackupEngine({ fetch: (...args) => bridged(...args), getToken: (_t, _c, scope) => appToken(scope) })
    host = new ApiHost({ routes: { ...routes, ...backupRoutes(engine) } })
    bridged = createBridgedFetch({
      dispatch: (request) => host.dispatch(request),
      fetch: originalFetch,
      handleLocalBlob: (request) => handleLocalBlobRequest(localStore, request),
      getDelegatedToken: async (tenant, clientId, scope) => {
        tokenRequests.push(scope)
        expect(tenant).toBe(env.tenantId)
        expect(clientId).toBe(env.clientId)
        return { accessToken: await appToken(scope), expiresOn: new Date(Date.now() + 3_000_000) }
      },
    })
    globalThis.fetch = bridged
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  /** Calls a route exactly like the renderer's fetch bridge does. */
  async function call(path: string, body?: Record<string, unknown>) {
    const response = await host.handleIpc({
      method: body ? "POST" : "GET",
      path,
      headers: { "content-type": "application/json" },
      body: body
        ? new TextEncoder().encode(
            JSON.stringify({ tenantId: env.tenantId, appId: env.clientId, clientSecret: DELEGATED_CLIENT_SECRET, ...body }),
          )
        : undefined,
    })
    const text = new TextDecoder().decode(response.body)
    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {
      /* not JSON */
    }
    console.log(`${path} -> ${response.status}`, text.slice(0, 300))
    return { status: response.status, json }
  }

  const azure = () => ({
    subscriptionId: env.subscriptionId,
    resourceGroupName: env.resourceGroupName,
    storageAccountName: env.storageAccountName,
  })

  it("reads tenant details from Microsoft Graph", async () => {
    const { status, json } = await call("/api/fetch-tenant-details", {})
    expect(status).toBe(200)
    expect(JSON.stringify(json)).toMatch(/[a-z]/i)
    expect(tokenRequests).toContain("https://graph.microsoft.com/.default")
  })

  it("lists Azure resources through Azure Resource Manager", async () => {
    const { status, json } = await call("/api/list-azure-resources", {})
    expect(status).toBe(200)
    expect(JSON.stringify(json)).toContain(env.subscriptionId)
    expect(tokenRequests).toContain("https://management.azure.com/.default")
  })

  it.skipIf(!env.storageAccountName)("lists backups in the storage account", async () => {
    const { status, json } = await call("/api/list-backups", azure())
    // Without a blob data role the route explains the missing role instead of a bare failure.
    if (status === 403) expect(json.details).toMatch(/Storage Blob Data Contributor/)
    else expect(status).toBe(200)
    expect(Array.isArray(json.backups)).toBe(true)
    expect(tokenRequests).toContain("https://storage.azure.com/.default")
  })

  /** Runs a full tenant backup through the backup routes and waits for it to finish. */
  async function backUp(resources: Record<string, string>) {
    const started = await call("/api/backup/start", resources)
    expect(started.status).toBe(200)
    const jobId = started.json.jobId as string

    let status: any
    // Stop polling before the calling test's timeout so an unfinished backup fails the assertion below.
    for (let i = 0; i < 780; i++) {
      status = (await call("/api/backup/status", { ...resources, jobId })).json
      if (status.isComplete) break
      await new Promise((r) => setTimeout(r, 1000))
    }
    console.log(status.output)
    expect(status.isSuccessful).toBe(true)
  }

  it("backs up the tenant to encrypted local storage and reads it back through the shared routes", async () => {
    const local = { subscriptionId: "local", resourceGroupName: "local", storageAccountName: localAccount }
    await backUp(local)

    const history = await call("/api/list-backups", local)
    expect(history.status).toBe(200)
    expect(history.json.backups.length).toBe(1)
    const backup = history.json.backups[0]
    console.log("backup summary:", JSON.stringify(backup).slice(0, 400))

    const contents = await call("/api/list-backup-contents", { ...local, backupId: backup.name ?? backup.id })
    expect(contents.status).toBe(200)

    const drift = await call("/api/detect-drifts", { ...local, backupLimit: 5 })
    expect(drift.status).toBe(200)
  }, 900_000)

  it.skipIf(!env.storageAccountName || !env.storageWrite)("backs up the tenant to Azure storage and reads it back through the shared routes", async () => {
    await verifyStorageAccess(bridged, env.storageAccountName, () => appToken("https://storage.azure.com/.default"))

    // Two backups: drift detection needs a baseline and a newer backup to compare.
    await backUp(azure())
    await new Promise((r) => setTimeout(r, 1500)) // backup folders are named by the second
    await backUp(azure())

    const history = await call("/api/list-backups", azure())
    expect(history.status).toBe(200)
    expect(history.json.backups.length).toBeGreaterThanOrEqual(2)
    const backup = history.json.backups[0]
    console.log("backup summary:", JSON.stringify(backup).slice(0, 400))

    const contents = await call("/api/list-backup-contents", { ...azure(), backupId: backup.name ?? backup.id })
    expect(contents.status).toBe(200)

    const drift = await call("/api/detect-drifts", { ...azure(), backupLimit: 5 })
    expect(drift.status).toBe(200)

    const download = await host.handleIpc({
      method: "POST",
      path: "/api/download-backup",
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode(
        JSON.stringify({ tenantId: env.tenantId, appId: env.clientId, clientSecret: DELEGATED_CLIENT_SECRET, ...azure(), backupId: backup.name ?? backup.id }),
      ),
    })
    expect(download.status).toBe(200)
    expect(new TextDecoder().decode(download.body.slice(0, 2))).toBe("PK")

    const metadata = { tenantId: env.tenantId, displayName: "TenuVault E2E", savedAt: new Date().toISOString() }
    expect((await call("/api/tenant-metadata/save", { storageAccountName: env.storageAccountName, metadata })).status).toBe(200)
    const loaded = await call("/api/tenant-metadata/load", { storageAccountName: env.storageAccountName })
    expect(loaded.status).toBe(200)
    expect(JSON.stringify(loaded.json)).toContain("TenuVault E2E")
    expect((await call("/api/tenant-metadata/delete", { storageAccountName: env.storageAccountName })).status).toBe(200)
  }, 1_800_000)

  it.skipIf(!env.storageAccountName)("explains missing Azure storage permissions before the first backup", async () => {
    const outcome = await verifyStorageAccess(bridged, env.storageAccountName, () => appToken("https://storage.azure.com/.default")).then(
      () => "writable",
      (error: Error) => error.message,
    )
    console.log("verify:", outcome)
    expect(outcome === "writable" || /Storage Blob Data Contributor/.test(outcome)).toBe(true)
  })
})
