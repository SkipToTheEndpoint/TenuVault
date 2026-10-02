import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Bell, Eye, Trash2 } from "lucide-react"
import type { Tenant } from "~/contexts/TenantContext"
import { Chip, Tile } from "~/components/dashboard/tiles"
import { Button } from "~/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog"
import { Input } from "~/components/ui/input"
import { toast } from "../../lib/toast"
import { formatTime, healthApi, type Endpoint, type Severity } from "./api"

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"]
const failed = (error: unknown) => toast(error instanceof Error ? error.message : "The request failed.", "error")

/**
 * Opt-in notification endpoints: a local system notification and admin-configured https
 * webhooks. Every endpoint shows its last delivery and errors; the preview shows exactly what
 * would be sent. A secret header value is write-only: it is never shown again after saving.
 */
export function EndpointsPanel({ tenant, endpoints, onChanged }: { tenant: Tenant; endpoints: Endpoint[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const hasLocal = endpoints.some((endpoint) => endpoint.kind === "local")
  const addLocal = useMutation({ mutationFn: () => healthApi.addEndpoint(tenant, { kind: "local" }), onSuccess: onChanged, onError: failed })
  const showPreview = useMutation({ mutationFn: (body: Record<string, unknown>) => healthApi.preview(tenant, body), onSuccess: (result) => setPreview(result.body), onError: failed })

  return (
    <Tile aria-labelledby="health-endpoints-heading" className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="health-endpoints-heading" className="flex items-center gap-2 text-lg font-medium text-gray-900">
            <Bell className="h-4 w-4 text-gray-500" aria-hidden="true" />
            Notifications
          </h3>
          <p className="max-w-3xl text-sm text-gray-600">Off until you add an endpoint. Sent only for new findings, once per finding until it resolves and reopens. Never sent: tokens, credentials, policy content, finding titles or owners.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!hasLocal && <Button type="button" variant="outline" size="sm" disabled={addLocal.isPending} onClick={() => addLocal.mutate()}>Notify on this computer</Button>}
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>Add webhook</Button>
        </div>
      </div>
      {endpoints.length === 0 && <p className="text-sm text-gray-500">No notifications are set up. Findings are only shown here.</p>}
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {endpoints.map((endpoint) => (
          <EndpointRow key={endpoint.id} tenant={tenant} endpoint={endpoint} onChanged={onChanged} onPreview={() => showPreview.mutate({ endpointId: endpoint.id })} />
        ))}
      </ul>
      {adding && <AddWebhook tenant={tenant} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); onChanged() }} onPreview={(body) => showPreview.mutate(body)} />}
      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Payload preview</DialogTitle>
            <DialogDescription>This is exactly the JSON body a webhook receives, built from the current findings. Local notifications show only counts on this computer.</DialogDescription>
          </DialogHeader>
          <pre className="max-h-96 overflow-auto rounded-2xl bg-gray-50 p-4 text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-100" tabIndex={0}>{preview}</pre>
        </DialogContent>
      </Dialog>
    </Tile>
  )
}

function EndpointRow({ tenant, endpoint, onChanged, onPreview }: { tenant: Tenant; endpoint: Endpoint; onChanged: () => void; onPreview: () => void }) {
  const update = useMutation({ mutationFn: (body: Record<string, unknown>) => healthApi.updateEndpoint(tenant, endpoint.id, body), onSuccess: onChanged, onError: failed })
  const remove = useMutation({ mutationFn: () => healthApi.removeEndpoint(tenant, endpoint.id), onSuccess: () => { toast("Endpoint removed", "success"); onChanged() }, onError: failed })
  const test = useMutation({
    mutationFn: () => healthApi.testEndpoint(tenant, endpoint.id),
    onSuccess: (result) => { toast(result.delivery.ok ? "Test delivered" : `Test failed: ${result.delivery.error ?? "unknown error"}`, result.delivery.ok ? "success" : "error"); onChanged() },
    onError: failed,
  })
  const last = endpoint.lastDelivery
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={endpoint.enabled ? "success" : "neutral"}>{endpoint.enabled ? "On" : "Off"}</Chip>
        <span className="font-medium text-gray-900">{endpoint.title}</span>
        <span className="text-sm text-gray-500">{endpoint.kind === "local" ? "System notification" : endpoint.url}</span>
        {endpoint.hasSecretHeader && <Chip tone="neutral">Secret header {endpoint.headerName} set</Chip>}
      </div>
      <p className={last && !last.ok ? "text-sm text-red-700" : "text-sm text-gray-600"} role={last && !last.ok ? "status" : undefined}>
        {last ? `${last.ok ? "Last delivery succeeded" : `Last delivery failed after ${last.attempts} attempts: ${last.error ?? "unknown error"}`} (${formatTime(last.at)}${last.test ? ", test" : ""})` : "Nothing delivered yet."}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2 text-gray-700">
          Minimum severity
          <select className="h-8 rounded-full border border-gray-200 bg-white px-3 text-sm dark:bg-input/30" value={endpoint.minSeverity} onChange={(event) => update.mutate({ minSeverity: event.target.value })}>
            {SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
          </select>
        </label>
        {endpoint.kind === "webhook" && (
          <>
            <label className="flex items-center gap-1.5 text-gray-700">
              <input type="checkbox" className="size-4 accent-coral-600" checked={endpoint.includeTenantName} onChange={(event) => update.mutate({ includeTenantName: event.target.checked })} />
              Include tenant name
            </label>
            <label className="flex items-center gap-1.5 text-gray-700">
              <input type="checkbox" className="size-4 accent-coral-600" checked={endpoint.includeIdentifiers} onChange={(event) => update.mutate({ includeIdentifiers: event.target.checked })} />
              Include tenant and record IDs
            </label>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => update.mutate({ enabled: !endpoint.enabled })} disabled={update.isPending}>{endpoint.enabled ? "Turn off" : "Turn on"}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>{test.isPending ? "Sending" : "Send test"}</Button>
        {endpoint.kind === "webhook" && <Button type="button" size="sm" variant="outline" onClick={onPreview}><Eye className="h-4 w-4" aria-hidden="true" />Preview payload</Button>}
        <Button type="button" size="sm" variant="outline" onClick={() => remove.mutate()} disabled={remove.isPending}><Trash2 className="h-4 w-4" aria-hidden="true" />Remove</Button>
      </div>
    </li>
  )
}

function AddWebhook({ tenant, onClose, onAdded, onPreview }: { tenant: Tenant; onClose: () => void; onAdded: () => void; onPreview: (body: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({ title: "", url: "", headerName: "", headerValue: "", minSeverity: "medium" as Severity, includeTenantName: false, includeIdentifiers: false })
  const add = useMutation({
    mutationFn: () => healthApi.addEndpoint(tenant, { kind: "webhook", ...form, title: form.title || undefined, headerName: form.headerName || undefined, headerValue: form.headerValue || undefined }),
    onSuccess: () => { toast("Webhook added", "success"); onAdded() },
    onError: failed,
  })
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }))
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a webhook</DialogTitle>
          <DialogDescription>An https endpoint you control, for example your ticketing or chat system. TenuVault posts JSON with counts, severities, finding keys and timestamps only.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); add.mutate() }}>
          <label className="block text-sm text-gray-700">Name<Input className="mt-1" maxLength={120} value={form.title} onChange={(event) => set({ title: event.target.value })} /></label>
          <label className="block text-sm text-gray-700">https URL<Input className="mt-1" type="url" required maxLength={2000} placeholder="https://" value={form.url} onChange={(event) => set({ url: event.target.value })} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-gray-700">Secret header name (optional)<Input className="mt-1" maxLength={64} value={form.headerName} onChange={(event) => set({ headerName: event.target.value })} /></label>
            <label className="block text-sm text-gray-700">Secret header value<Input className="mt-1" type="password" autoComplete="off" maxLength={2000} value={form.headerValue} onChange={(event) => set({ headerValue: event.target.value })} /></label>
          </div>
          <p className="text-xs text-gray-500">The header value is stored encrypted on this computer and is never shown again.</p>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            Minimum severity
            <select className="h-8 rounded-full border border-gray-200 bg-white px-3 text-sm dark:bg-input/30" value={form.minSeverity} onChange={(event) => set({ minSeverity: event.target.value as Severity })}>
              {SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" className="size-4 accent-coral-600" checked={form.includeTenantName} onChange={(event) => set({ includeTenantName: event.target.checked })} />Include the tenant display name</label>
          <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" className="size-4 accent-coral-600" checked={form.includeIdentifiers} onChange={(event) => set({ includeIdentifiers: event.target.checked })} />Include tenant and record IDs (otherwise replaced by short references)</label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onPreview({ includeTenantName: form.includeTenantName, includeIdentifiers: form.includeIdentifiers, minSeverity: form.minSeverity })}>Preview payload</Button>
            <Button type="submit" disabled={add.isPending || !form.url}>Add webhook</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
