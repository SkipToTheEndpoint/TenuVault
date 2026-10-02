import { useEffect, useState } from "react"
import { Download, History } from "lucide-react"
import type { FrameworkWorkspace } from "../../../main/frameworks/workspaces"
import type { ExportFile } from "../../../main/frameworks/service"
import type { Finding } from "../../../shared/frameworks/policies"
import { button, card, errorText, type OibTenant } from "./common"
import { useFocusOnChange } from "./FlowShell"
import { Notice, saveFile, useSaveNotice } from "./notices"

const STATUSES = ["Present", "Missing", "Different", "Review"] as const
const COLORS: Record<Finding["status"], string> = { Present: "bg-green-50 text-green-800", Missing: "bg-amber-50 text-amber-900", Different: "bg-red-50 text-red-800", Review: "bg-gray-100 text-gray-700" }
const PAGE = 50

async function frameworkRequest<T>(body: object): Promise<T> {
  const response = await fetch("/api/frameworks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const result = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`)
  return result
}

function counts(findings: Finding[]) {
  return STATUSES.map(status => ({ status, count: findings.filter(f => f.status === status).length }))
}

/**
 * Read-only access to OIB pack comparisons saved by the former OpenIntuneBaseline framework
 * page. Renders nothing when the tenant has none.
 */
export function EarlierComparisons({ tenant }: { tenant: OibTenant }) {
  const [workspace, setWorkspace] = useState<FrameworkWorkspace | null>(null)
  const [loadError, setLoadError] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState<"All" | Finding["status"]>("All")
  const [page, setPage] = useState(0)
  const notice = useSaveNotice()
  // Which export the notice belongs to: a run id, or "all".
  const [exported, setExported] = useState("")
  // Paging moves the list back to its top.
  const listTop = useFocusOnChange<HTMLDivElement>(page)

  useEffect(() => {
    let active = true
    setWorkspace(null); setLoadError(""); setOpen(null)
    frameworkRequest<FrameworkWorkspace>({ action: "workspace-load", tenantId: tenant.tenantId, frameworkId: "oib" })
      .then(saved => { if (active) setWorkspace(saved) })
      .catch((e: unknown) => { if (active) setLoadError(e instanceof Error ? e.message : "Saved comparisons could not be read.") })
    return () => { active = false }
  }, [tenant.tenantId])

  const exportSaved = (format: "pdf" | "csv" | "json", runId?: string) => {
    setExported(runId ?? "all")
    void notice.save(async () => {
      const file = await frameworkRequest<{ file: ExportFile }>({ action: `workspace-${format}`, tenantId: tenant.tenantId, tenantName: tenant.name, frameworkId: "oib", ...(runId ? { runId } : {}) })
        .then(r => r.file, (e: unknown) => { throw new Error(errorText(e, "The export could not be prepared.")) })
      return saveFile(file.data, file.name, file.encoding)
    })
  }
  const exportNotice = (id: string) => exported === id && (notice.saving ? <p role="status" className="mt-3 text-sm text-blue-700">Preparing the export…</p> : <Notice className="mt-3 w-full" result={notice.result} onDismiss={notice.clear} />)

  if (!loadError && !workspace?.history.length) return null
  const selected = workspace?.history.find(entry => entry.assessment.runId === open)
  const findings = selected?.assessment.findings.filter(f => filter === "All" || f.status === filter) ?? []

  return <section className={`${card} mt-6`} aria-labelledby="earlier-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-secondary text-foreground" aria-hidden="true"><History className="h-[18px] w-[18px]" /></span>
        <h2 id="earlier-title" className="text-lg font-medium">Earlier comparisons</h2>
      </div>
      {!!workspace?.history.length && <button type="button" className={button} disabled={notice.saving} onClick={() => exportSaved("json")}><Download className="h-4 w-4" aria-hidden="true" />Export all (JSON)</button>}
    </div>
    {exportNotice("all")}
    <p className="mt-2 text-sm text-gray-600">Policy pack comparisons saved by the former OpenIntuneBaseline framework page, kept on this device. They are read-only. New comparisons use the Existing Deployment and Policy Validation workflows.</p>
    {loadError && <p role="alert" className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</p>}
    {workspace && <ul className="mt-4 divide-y divide-gray-100">{workspace.history.map(entry => {
      const { assessment } = entry
      return <li key={assessment.runId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
        <div className="min-w-0">
          <p className="font-medium text-gray-900">{new Date(assessment.assessedAt).toLocaleString()}</p>
          <p className="break-words text-gray-600">{assessment.reference || "No pack reference"}</p>
          <p className="mt-1 flex flex-wrap gap-2 text-xs">{counts(assessment.findings).map(({ status, count }) => <span key={status} className={`rounded-full px-2.5 py-0.5 ${COLORS[status]}`}>{status} {count}</span>)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} aria-expanded={open === assessment.runId} onClick={() => { setOpen(open === assessment.runId ? null : assessment.runId); setFilter("All"); setPage(0) }}>{open === assessment.runId ? "Hide findings" : "View findings"}</button>
          {(["pdf", "csv", "json"] as const).map(format => <button key={format} type="button" className={button} disabled={notice.saving} onClick={() => exportSaved(format, assessment.runId)}><Download className="h-4 w-4" aria-hidden="true" />{format === "pdf" ? "PDF" : format.toUpperCase()}</button>)}
        </div>
        {exportNotice(assessment.runId)}
      </li>
    })}</ul>}
    {selected && <div className="mt-4 border-t pt-4">
      <p className="text-xs text-gray-500">{selected.assessment.policyCount} tenant policies read · {new Date(selected.assessment.assessedAt).toLocaleString()} · saved result, not current tenant evidence</p>
      <div className="my-3 flex flex-wrap gap-2" aria-label="Filter findings">{(["All", ...STATUSES] as const).map(status => <button key={status} type="button" aria-pressed={filter === status} onClick={() => { setFilter(status); setPage(0) }} className={`rounded-full border px-4 py-2 text-sm transition-colors ${filter === status ? "border-transparent bg-primary text-primary-foreground" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>{status} <span className="ml-1 font-semibold">{selected.assessment.findings.filter(f => status === "All" || f.status === status).length}</span></button>)}</div>
      <div ref={listTop} tabIndex={-1} role="group" className="scroll-mt-6 space-y-2 outline-none" aria-label={`Findings, page ${page + 1}`}>{findings.slice(page * PAGE, (page + 1) * PAGE).map(f => <details key={f.key} className="rounded-2xl bg-gray-50 p-4">
        <summary className="cursor-pointer text-sm"><span className="font-medium text-gray-800">{f.policyName}</span><span className={`ml-2 inline-block rounded-full px-2.5 py-0.5 text-xs ${COLORS[f.status]}`}>{f.status}</span><span className="mt-1 block break-all font-mono text-xs leading-5 text-gray-500">{f.settingId}</span></summary>
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <div><p className="mb-2 text-xs font-semibold text-gray-600">Recommended configuration</p><pre className="max-h-72 overflow-auto rounded-2xl bg-white p-3 text-xs">{JSON.stringify(f.recommended, null, 2)}</pre></div>
          <div><p className="mb-2 text-xs font-semibold text-gray-600">Observed policies and configuration</p><pre className="max-h-72 overflow-auto rounded-2xl bg-white p-3 text-xs">{f.observed.length ? JSON.stringify(f.observed, null, 2) : "No matching root setting found in the assessed policy family."}</pre></div>
        </div>
      </details>)}</div>
      {findings.length > PAGE && <div className="mt-4 flex items-center justify-between gap-3"><button type="button" className={button} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span className="text-sm text-gray-500">Page {page + 1} of {Math.ceil(findings.length / PAGE)}</span><button type="button" className={button} disabled={(page + 1) * PAGE >= findings.length} onClick={() => setPage(page + 1)}>Next</button></div>}
      {!findings.length && <p role="status" className="py-6 text-center text-sm text-gray-500">No findings in this category.</p>}
      {selected.creation && <div className="mt-4 rounded-2xl bg-gray-50 p-4 text-sm"><p className="font-medium text-gray-800">Policies created from this comparison</p><ul className="mt-2 space-y-1 text-gray-600">{selected.creation.results.map((r, i) => <li key={i}>{r.name}: {r.error || `Created (${r.id})`}</li>)}</ul></div>}
    </div>}
  </section>
}
