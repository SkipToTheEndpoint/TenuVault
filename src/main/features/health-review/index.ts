import type { RouteModule } from "../../api/host"
import { allows } from "../../../shared/plans"
import type { FeatureDeps } from "../deps"
import { DOMAINS } from "../domains"
import type { Stored } from "../records"
import { featureRoute, FeatureError, optionalText, text, type Body } from "../route"
import { clampInterval, THRESHOLDS, validateHeader, validateWebhookUrl, type HealthFinding, type Severity } from "./rules"
import {
  countFindings,
  deliver,
  endpointsOf,
  findingsOf,
  payloadFor,
  ReviewInProgress,
  runReview,
  runsOf,
  saveSchedule,
  scheduleOf,
  tick,
  type EndpointRecord,
} from "./service"

/** How often the scheduler checks for due reviews while the app runs. */
const TICK_MS = 60_000

/** Shown next to every schedule: what the desktop scheduler can and cannot do. */
export const RUNTIME_NOTE =
  "Scheduled reviews and notifications run only while TenuVault is running on this computer and you are signed in to the tenant. A closed, asleep or signed-out computer does not review or notify; the next review after such a gap runs once to catch up."

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"]
const MAX_ENDPOINTS = 10

/** /api/health-review (#147). */
export function routes(deps: FeatureDeps): Record<string, RouteModule> {
  return featureRoute("/api/health-review", deps, {
    // Stored records only; readable on every plan.
    "get-status": async ({ tenantId, deps, plan }) => {
      const schedule = scheduleOf(deps, tenantId)
      const runs = runsOf(deps, tenantId)
      const findings = findingsOf(deps, tenantId)
      const signedIn = deps.actor(tenantId) !== null
      const isLicensed = allows(plan, "healthReview")
      const readiness = !isLicensed
        ? { state: "not-licensed", message: "The plan of this tenant does not include scheduled health reviews. Stored results stay readable." }
        : !schedule?.enabled
          ? { state: "disabled", message: "Scheduled reviews are off. You can still review now." }
          : !signedIn
            ? { state: "sign-in-required", message: "Not signed in to this tenant: reviews cannot read backups and are recorded as could not authenticate." }
            : { state: "ready", message: "Ready. The next review runs when due while TenuVault is running." }
      return {
        schedule: schedule ? stripHistory(schedule) : null,
        readiness: { ...readiness, appRunning: true, signedIn, licensed: isLicensed, note: RUNTIME_NOTE },
        lastRun: runs[0] ? stripHistory(runs[0]) : null,
        counts: countFindings(findings),
        thresholds: THRESHOLDS,
        endpoints: endpointsOf(deps, tenantId).map(publicEndpoint),
      }
    },
    "list-findings": ({ tenantId, deps }) => ({ findings: findingsOf(deps, tenantId).map(findingView) }),
    "list-runs": ({ tenantId, deps }) => ({ runs: runsOf(deps, tenantId).slice(0, 50).map(stripHistory) }),

    "run-review": async ({ tenantId, deps, actor }) => {
      try {
        const { run, findings } = await runReview(deps, tenantId, "manual", actor)
        return { run: stripHistory(run), findings: findings.map(findingView) }
      } catch (error) {
        if (error instanceof ReviewInProgress) throw new FeatureError(error.message, 409)
        throw error
      }
    },
    "update-schedule": ({ tenantId, body, deps, actor }) => {
      const enabled = bool(body, "enabled")
      const interval = body.intervalHours === undefined ? undefined : Number(body.intervalHours)
      if (interval !== undefined && !Number.isFinite(interval)) throw new FeatureError("intervalHours is invalid")
      const current = scheduleOf(deps, tenantId)
      const turnedOn = enabled === true && !current?.enabled
      const schedule = saveSchedule(deps, tenantId, {
        ...(enabled === undefined ? {} : { enabled }),
        ...(interval === undefined ? {} : { intervalHours: clampInterval(interval) }),
        // Turning the schedule on makes the first review due right away.
        ...(turnedOn ? { nextDueAt: deps.now().toISOString() } : {}),
      }, { actor, reason: enabled === false ? "Scheduled reviews turned off" : turnedOn ? "Scheduled reviews turned on" : "Schedule changed" })
      return { schedule: stripHistory(schedule) }
    },
    "acknowledge-finding": ({ tenantId, body, deps, actor }) => {
      const finding = requireFinding(deps, tenantId, body)
      const updated = deps.records.update<HealthFinding>(DOMAINS.healthFindings, tenantId, finding.id, (value) => ({ ...value, acknowledgedAt: deps.now().toISOString(), acknowledgedBy: actor }), { actor, reason: optionalText(body, "note", 500) ?? "Acknowledged" })
      return { finding: findingView(updated!) }
    },
    "set-finding-owner": ({ tenantId, body, deps, actor }) => {
      const finding = requireFinding(deps, tenantId, body)
      const owner = optionalText(body, "owner", 200)
      const updated = deps.records.update<HealthFinding>(DOMAINS.healthFindings, tenantId, finding.id, (value) => ({ ...value, owner }), { actor, reason: owner ? `Owner set to ${owner}` : "Owner cleared" })
      return { finding: findingView(updated!) }
    },

    "add-endpoint": ({ tenantId, body, deps, actor }) => {
      const endpoints = endpointsOf(deps, tenantId)
      if (endpoints.length >= MAX_ENDPOINTS) throw new FeatureError("Remove an endpoint before adding another.")
      const kind = body.kind === "local" ? "local" : body.kind === "webhook" ? "webhook" : null
      if (!kind) throw new FeatureError("kind must be local or webhook")
      if (kind === "local" && endpoints.some((endpoint) => endpoint.kind === "local")) throw new FeatureError("Local notifications are already set up for this tenant.", 409)
      let url: string | null = null
      let headerName: string | null = null
      let headerValue: string | null = null
      if (kind === "webhook") {
        const checked = validateWebhookUrl(text(body, "url", 2000))
        if (!checked.ok) throw new FeatureError(checked.error)
        url = checked.url
        headerName = optionalText(body, "headerName", 64)
        headerValue = optionalText(body, "headerValue", 2000)
        const header = validateHeader(headerName, headerValue)
        if (!header.ok) throw new FeatureError(header.error)
      }
      const value: EndpointRecord = {
        kind,
        title: optionalText(body, "title", 120) ?? (kind === "local" ? "This computer" : new URL(url!).hostname),
        status: "enabled",
        summary: kind === "local" ? "System notifications on this computer." : `POST to ${new URL(url!).hostname}.`,
        enabled: true,
        url,
        headerName,
        headerValue,
        minSeverity: severity(body.minSeverity) ?? "medium",
        includeTenantName: bool(body, "includeTenantName") ?? false,
        includeIdentifiers: bool(body, "includeIdentifiers") ?? false,
        sent: {},
        lastDelivery: null,
        deliveries: [],
      }
      const created = deps.records.create<EndpointRecord>(DOMAINS.notificationEndpoints, tenantId, value, { actor, reason: `Notification endpoint added (${kind})` })
      return { endpoint: publicEndpoint(created) }
    },
    "update-endpoint": ({ tenantId, body, deps, actor }) => {
      const endpoint = requireEndpoint(deps, tenantId, body)
      const enabled = bool(body, "enabled")
      const includeTenantName = bool(body, "includeTenantName")
      const includeIdentifiers = bool(body, "includeIdentifiers")
      const minSeverity = body.minSeverity === undefined ? undefined : severity(body.minSeverity)
      if (minSeverity === null) throw new FeatureError("minSeverity is invalid")
      const secret: Partial<EndpointRecord> = {}
      if (endpoint.kind === "webhook" && (body.headerName !== undefined || body.headerValue !== undefined)) {
        const headerName = optionalText(body, "headerName", 64)
        const headerValue = optionalText(body, "headerValue", 2000)
        const header = validateHeader(headerName, headerValue)
        if (!header.ok) throw new FeatureError(header.error)
        Object.assign(secret, { headerName, headerValue })
      }
      const changes: string[] = []
      if (enabled !== undefined) changes.push(enabled ? "enabled" : "disabled")
      if (minSeverity) changes.push(`minimum severity ${minSeverity}`)
      if (includeTenantName !== undefined) changes.push(includeTenantName ? "tenant name included" : "tenant name excluded")
      if (includeIdentifiers !== undefined) changes.push(includeIdentifiers ? "identifiers included" : "identifiers redacted")
      if ("headerValue" in secret) changes.push(secret.headerValue ? "secret header replaced" : "secret header removed")
      const updated = deps.records.update<EndpointRecord>(DOMAINS.notificationEndpoints, tenantId, endpoint.id, (value) => {
        const next = {
          ...value,
          ...secret,
          ...(enabled === undefined ? {} : { enabled, status: enabled ? ("enabled" as const) : ("disabled" as const) }),
          ...(minSeverity ? { minSeverity } : {}),
          ...(includeTenantName === undefined ? {} : { includeTenantName }),
          ...(includeIdentifiers === undefined ? {} : { includeIdentifiers }),
        }
        return next
      }, { actor, reason: changes.length ? `Endpoint ${changes.join(", ")}` : "Endpoint saved" })
      return { endpoint: publicEndpoint(updated!) }
    },
    "revoke-endpoint": ({ tenantId, body, deps }) => {
      const endpoint = requireEndpoint(deps, tenantId, body)
      deps.records.remove(DOMAINS.notificationEndpoints, tenantId, endpoint.id)
      return { removed: endpoint.id }
    },
    "test-endpoint": async ({ tenantId, body, deps, actor }) => {
      const endpoint = requireEndpoint(deps, tenantId, body)
      const payload = payloadFor(deps, tenantId, endpoint, [], findingsOf(deps, tenantId), { reviewedAt: runsOf(deps, tenantId)[0]?.finishedAt ?? null, status: "test" }, true)
      // A test is one attempt so the admin sees the result right away.
      const delivery = await deliver(deps, endpoint, payload, [], deps.tenant(tenantId)?.name ?? null, { attempts: 1 })
      const updated = deps.records.update<EndpointRecord>(DOMAINS.notificationEndpoints, tenantId, endpoint.id, (value) => ({ ...value, lastDelivery: delivery, deliveries: [...value.deliveries, delivery].slice(-20) }), { actor, reason: delivery.ok ? "Test delivery succeeded" : `Test delivery failed: ${delivery.error ?? "unknown error"}` })
      return { delivery, endpoint: publicEndpoint(updated!) }
    },
    "preview-payload": ({ tenantId, body, deps }) => {
      const endpoint = typeof body.endpointId === "string" ? requireEndpoint(deps, tenantId, body) : null
      const options = {
        includeTenantName: bool(body, "includeTenantName") ?? endpoint?.includeTenantName ?? false,
        includeIdentifiers: bool(body, "includeIdentifiers") ?? endpoint?.includeIdentifiers ?? false,
      }
      const findings = findingsOf(deps, tenantId)
      const minimum = severity(body.minSeverity) ?? endpoint?.minSeverity ?? "medium"
      const listed = findings.filter((finding) => finding.state !== "resolved" && SEVERITIES.indexOf(finding.severity) <= SEVERITIES.indexOf(minimum))
      const last = runsOf(deps, tenantId)[0]
      const payload = payloadFor(deps, tenantId, options, listed, findings, { reviewedAt: last?.finishedAt ?? null, status: last?.status ?? null })
      return { payload, body: JSON.stringify(payload, null, 2), kind: endpoint?.kind ?? "webhook" }
    },

    // MSP: stored review status of each customer tenant, for portfolio triage.
    "portfolio-status": ({ tenantId, targetTenants, deps }) => ({
      tenants: [tenantId, ...targetTenants].map((id) => {
        const schedule = scheduleOf(deps, id)
        const lastRun = runsOf(deps, id)[0] ?? null
        const findings = findingsOf(deps, id)
        return {
          tenantId: id,
          name: deps.tenant(id)?.name ?? null,
          signedIn: deps.actor(id) !== null,
          scheduleEnabled: schedule?.enabled ?? false,
          lastReviewAt: schedule?.lastReviewAt ?? null,
          lastOutcome: schedule?.lastOutcome ?? null,
          nextDueAt: schedule?.enabled ? schedule.nextDueAt : null,
          lastRunStatus: lastRun?.status ?? null,
          counts: countFindings(findings),
          owners: [...new Set(findings.filter((finding) => finding.state !== "resolved" && finding.owner).map((finding) => finding.owner!))],
        }
      }),
    }),
  })
}

/**
 * Background scheduler: checks for due reviews every minute while the app runs. Nothing runs
 * while the app is closed; see RUNTIME_NOTE.
 */
export function start(deps: FeatureDeps): () => void {
  const timer = setInterval(() => void tick(deps).catch(() => undefined), TICK_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

function requireFinding(deps: FeatureDeps, tenantId: string, body: Body): Stored<HealthFinding> {
  const finding = deps.records.get<HealthFinding>(DOMAINS.healthFindings, tenantId, text(body, "findingId", 100))
  if (!finding) throw new FeatureError("Finding not found", 404)
  return finding
}

function requireEndpoint(deps: FeatureDeps, tenantId: string, body: Body): Stored<EndpointRecord> {
  const endpoint = deps.records.get<EndpointRecord>(DOMAINS.notificationEndpoints, tenantId, text(body, "endpointId", 100))
  if (!endpoint) throw new FeatureError("Endpoint not found", 404)
  return endpoint
}

function bool(body: Body, key: string): boolean | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new FeatureError(`${key} must be true or false`)
  return value
}

function severity(value: unknown): Severity | null {
  return typeof value === "string" && (SEVERITIES as string[]).includes(value) ? (value as Severity) : null
}

function stripHistory<T extends { history?: unknown }>(record: T): Omit<T, "history"> {
  const { history: _history, ...rest } = record
  return rest
}

/** A finding with its change history (actor, reason, time) but without snapshots. */
function findingView(finding: Stored<HealthFinding>) {
  const { history, ...rest } = finding
  return { ...rest, history: history.map(({ at, actor, reason }) => ({ at, actor, reason })) }
}

/**
 * An endpoint as the renderer may see it: the secret header value is never returned, only
 * whether one is set. History snapshots (which contain it) are dropped.
 */
export function publicEndpoint(endpoint: Stored<EndpointRecord>) {
  const { history, headerValue, sent: _sent, ...rest } = endpoint
  return { ...rest, hasSecretHeader: Boolean(headerValue), history: history.map(({ at, actor, reason }) => ({ at, actor, reason })) }
}
