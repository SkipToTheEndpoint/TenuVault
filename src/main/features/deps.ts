import type { GraphCall } from "../../portal/lib/policies/graph-restore"
import type { Plan } from "../../shared/plans"
import { DELEGATED_CLIENT_SECRET } from "../../shared/constants"
import type { TenantRecords } from "./records"

/** A connected tenant as the main process knows it. */
export interface TenantProfile {
  tenantId: string
  name: string
  clientId: string
  storageAccountName: string
}

/**
 * What the roadmap workflows get from the app. Everything is injected, so each workflow is
 * tested with fakes (see test/helpers/feature-deps.ts) and never reaches for globals.
 */
export interface FeatureDeps {
  records: TenantRecords
  /** The tenant's plan; throws when the tenant is not signed in or not licensed. */
  plan: (tenantId: string) => Promise<Plan>
  /** Whether two tenants are covered by the same license (Pro promotion stays inside it). */
  sameLicense: (a: string, b: string) => boolean
  /** A connected tenant, or null. */
  tenant: (tenantId: string) => TenantProfile | null
  /** IDs of every connected tenant. */
  tenants: () => string[]
  /** The signed-in admin of a tenant, for attributing records; null when unknown. */
  actor: (tenantId: string) => { id: string; name: string } | null
  /**
   * Microsoft Graph (beta) for a tenant with the signed-in admin's delegated token. With
   * `journal`, every non-GET call is recorded in the restore write journal as uncertain until
   * its outcome is known, and a repeated uncertain write is refused until reconciled.
   */
  graph: (tenantId: string, options?: { journal?: boolean }) => Promise<GraphCall>
  /**
   * Calls one of the app's own API routes with the tenant's credentials filled in
   * (see apiBody).
   */
  api: (path: string, tenantId: string, body?: Record<string, unknown>) => Promise<Response>
  /** fetch for customer-configured endpoints (notification webhooks); never Graph or storage. */
  externalFetch: typeof fetch
  /** A system notification on this computer. */
  notify: (title: string, body: string) => void
  now: () => Date
}

/**
 * The JSON body deps.api sends to one of the app's own routes: the caller's fields, the
 * tenant's credentials, and subscriptionId and resourceGroupName defaulted to "local". The
 * backup routes require those two but storage never uses them, for local or Azure accounts.
 */
export function apiBody(tenantId: string, profile: Pick<TenantProfile, "clientId" | "storageAccountName">, body: Record<string, unknown> = {}): Record<string, unknown> {
  return { subscriptionId: "local", resourceGroupName: "local", ...body, tenantId, appId: profile.clientId, clientSecret: DELEGATED_CLIENT_SECRET, storageAccountName: profile.storageAccountName }
}
