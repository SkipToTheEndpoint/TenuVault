import { useEffect, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, Circle, LoaderCircle, RotateCcw } from "lucide-react"
import { cn } from "~/lib/utils"
import { OIB_PLATFORMS, type OibCatalog, type OibComparison, type OibPlatform } from "../../../shared/oib/types"
import { button, compareCatalog, errorText, loadCatalog, oibRequest, platformsLabel, versionLabel, type LoadedPlatform, type OibTenant, type Selections } from "./common"
import type { Progress } from "./FlowShell"

/**
 * One platform's load: "loading" until the pack is local ("downloading" while files arrive),
 * "loaded" with the pack only, "comparing" while the tenant is read, then "ready" or "error".
 * `cached` is set when the pack came from the cache without a download.
 */
export interface PlatformStatus {
  state: "loading" | "downloading" | "loaded" | "comparing" | "ready" | "error"
  done?: number
  total?: number
  cached?: boolean
  catalog?: OibCatalog
  comparison?: OibComparison
  error?: string
}

export type PlatformLoader = ReturnType<typeof usePlatformLoader>

type Downloads = { downloads: Array<{ platform: OibPlatform; commit: string; done: number; total: number }> }

/**
 * Loads the selected platform packs side by side and compares each with the tenant. A platform
 * that fails keeps its error (retry it alone); platforms that loaded are kept.
 * `start({ compare: false })` only loads the packs (to download early); `compare()` then reads the tenant.
 */
export function usePlatformLoader(tenant: OibTenant | null, selections: Selections, platforms: OibPlatform[]) {
  const [status, setStatus] = useState<Partial<Record<OibPlatform, PlatformStatus>>>({})
  const generation = useRef<Partial<Record<OibPlatform, number>>>({})
  const downloaded = useRef(new Set<OibPlatform>())
  const compares = useRef(true)
  // Callers often build `selections` per render; the download poll reads the latest without restarting.
  const latest = useRef(selections)
  latest.current = selections
  const set = (platform: OibPlatform, gen: number, next: PlatformStatus | ((current?: PlatformStatus) => PlatformStatus)) => {
    if (generation.current[platform] !== gen) return
    setStatus(s => ({ ...s, [platform]: typeof next === "function" ? next(s[platform]) : next }))
  }

  async function run(platform: OibPlatform, compare: boolean, reuse?: PlatformStatus) {
    if (!tenant) return
    const gen = (generation.current[platform] ?? 0) + 1
    generation.current[platform] = gen
    const selection = selections[platform]
    let catalog = reuse?.catalog && reuse.catalog.commit === selection.commit && reuse.catalog.tag === selection.tag ? reuse.catalog : undefined
    let cached = reuse?.cached
    try {
      if (!catalog) {
        downloaded.current.delete(platform)
        set(platform, gen, { state: "loading" })
        catalog = await loadCatalog(tenant, platform, selection)
        cached = !downloaded.current.has(platform)
      }
      // compare() during the download asks for the comparison once the pack is in.
      if (!compare && !compares.current) { set(platform, gen, { state: "loaded", catalog, cached }); return }
      set(platform, gen, { state: "comparing", catalog, cached })
      const comparison = await compareCatalog(tenant, catalog)
      set(platform, gen, { state: "ready", catalog, comparison, cached })
    } catch (error) {
      set(platform, gen, { state: "error", catalog, cached, error: errorText(error, `OpenIntuneBaseline ${OIB_PLATFORMS[platform].label} could not be loaded.`) })
    }
  }

  const downloading = platforms.some(p => status[p]?.state === "loading" || status[p]?.state === "downloading")
  useEffect(() => {
    if (!downloading) return
    const timer = setInterval(() => void oibRequest<Downloads>({ action: "oib-downloads" }).then(({ downloads }) => {
      for (const d of downloads) {
        if (latest.current[d.platform]?.commit !== d.commit || !d.total) continue
        downloaded.current.add(d.platform)
        setStatus(s => s[d.platform]?.state === "loading" || s[d.platform]?.state === "downloading" ? { ...s, [d.platform]: { state: "downloading", done: d.done, total: d.total } } : s)
      }
    }).catch(() => undefined), 700)
    return () => clearInterval(timer)
  }, [downloading])

  const rows = platforms.map(p => [p, status[p]] as const)
  const loaded: LoadedPlatform[] = rows.flatMap(([, s]) => s?.state === "ready" ? [{ catalog: s.catalog!, comparison: s.comparison! }] : [])
  const catalogs: OibCatalog[] = rows.flatMap(([, s]) => s?.catalog && s.state !== "loading" && s.state !== "downloading" ? [s.catalog] : [])
  const failed = rows.flatMap(([p, s]) => s?.state === "error" ? [p] : [])
  const busy = rows.some(([, s]) => s && ["loading", "downloading", "comparing"].includes(s.state))
  const files = rows.flatMap(([p, s]) => s?.state === "downloading" ? [{ p, done: s.done ?? 0, total: s.total ?? 0 }] : [])
  const line: Progress | null = files.length
    ? { stage: `Downloading OpenIntuneBaseline ${platformsLabel(files.map(f => f.p))}: ${files.reduce((n, f) => n + f.done, 0)} of ${files.reduce((n, f) => n + f.total, 0)} files`, percent: (files.reduce((n, f) => n + f.done, 0) / Math.max(1, files.reduce((n, f) => n + f.total, 0))) * 100 }
    : rows.some(([, s]) => s?.state === "loading") ? { stage: "Loading the OpenIntuneBaseline packs" }
    : rows.some(([, s]) => s?.state === "comparing") ? { stage: "Reading your tenant's policies" }
    : null

  return {
    status,
    /** Platforms compared with the tenant, in the order given. */
    loaded,
    /** Packs that are local, compared or not. */
    catalogs,
    failed,
    busy,
    /** Every platform has finished, ready or failed. */
    settled: platforms.length > 0 && rows.every(([, s]) => s && (s.state === "ready" || s.state === "error" || (!compares.current && s.state === "loaded"))),
    /** Whether the last start compares (LoadProgress shows the tenant stages only then). */
    compares: compares.current,
    /** The current stage for ActionBar, or null. */
    line,
    /** Loads every platform again (packs come from the cache after the first download) and compares unless told not to. */
    start(options: { compare?: boolean } = {}) {
      compares.current = options.compare !== false
      setStatus({})
      for (const p of platforms) void run(p, compares.current)
    },
    /** Compares the platforms whose pack is loaded but not compared yet; reuses loaded packs, loads the rest. */
    compare() {
      compares.current = true
      for (const p of platforms) {
        const s = status[p]
        // A pack still downloading is compared when it arrives (see run).
        if (s?.state === "loading" || s?.state === "downloading" || s?.state === "comparing" || s?.state === "ready") continue
        void run(p, true, s)
      }
    },
    /** Retries one failed platform; its pack is reused when it loaded and only the comparison failed. */
    retry(platform: OibPlatform) {
      void run(platform, compares.current, status[platform])
    },
    reset() {
      // Bump rather than clear, so a run still in flight can never match a later generation.
      for (const p of Object.keys(generation.current) as OibPlatform[]) generation.current[p] = (generation.current[p] ?? 0) + 1
      setStatus({})
    },
  }
}

const icon = (state: "pending" | "active" | "done" | "error") => state === "done" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
  : state === "active" ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-blue-700" aria-hidden="true" />
  : state === "error" ? <AlertTriangle className="h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
  : <Circle className="h-4 w-4 shrink-0 text-gray-300" aria-hidden="true" />

/**
 * Staged load progress: one row per platform (download count, cached, ready, or an error with
 * Retry), then reading the tenant and comparing. Render it in place of the step content.
 */
export function LoadProgress({ loader, platforms, selections }: { loader: PlatformLoader; platforms: OibPlatform[]; selections: Selections }) {
  const states = platforms.map(p => loader.status[p])
  const compared = states.filter(s => s && s.state !== "error")
  const reading = compared.some(s => s!.state === "comparing") ? "active" : compared.length && compared.every(s => s!.state === "ready") ? "done" : "pending"
  // A pack still on its way has not been compared, so comparing waits for every pack.
  const comparing = compared.length && compared.every(s => s!.state === "ready") ? "done" : "pending"
  return <div className="space-y-5">
    <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl bg-gray-50" aria-label="OpenIntuneBaseline packs">{platforms.map(p => {
      const s = loader.status[p]
      const label = `${OIB_PLATFORMS[p].label} ${versionLabel(s?.catalog ?? selections[p])}`
      const text = !s ? "Waiting"
        : s.state === "loading" ? "Checking for a cached copy"
        : s.state === "downloading" ? `Downloading ${s.done ?? 0} of ${s.total ?? 0} files`
        : s.state === "error" ? "Could not be loaded"
        : s.state === "ready" ? (s.cached ? "Ready, from the cache" : "Ready")
        : s.cached ? "Cached" : "Downloaded"
      return <li key={p} className="p-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          {icon(!s ? "pending" : s.state === "error" ? "error" : s.state === "loading" || s.state === "downloading" ? "active" : "done")}
          <span className="font-medium text-gray-900">{label}</span>
          <span className={cn("flex-1 text-xs", s?.state === "error" ? "text-red-800" : "text-gray-600")}>{text}</span>
          {s?.state === "error" && <button type="button" className={cn(button, "h-8 px-3 text-xs")} onClick={() => loader.retry(p)}><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Retry {OIB_PLATFORMS[p].label}</button>}
        </div>
        {s?.state === "downloading" && !!s.total && <div className="ml-7 mt-2 h-1.5 max-w-md overflow-hidden rounded-full bg-gray-200" aria-hidden="true"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((s.done ?? 0) / s.total) * 100}%` }} /></div>}
        {s?.state === "error" && <p role="alert" className="ml-7 mt-2 text-xs leading-5 text-red-800">{s.error}</p>}
      </li>
    })}</ul>
    {loader.compares && <ol className="space-y-2 text-sm" aria-label="Tenant stages">
      <li className={cn("flex items-center gap-3", reading === "pending" ? "text-gray-500" : "text-gray-900")}>{icon(reading)}Reading your tenant's policies</li>
      <li className={cn("flex items-center gap-3", comparing === "pending" ? "text-gray-500" : "text-gray-900")}>{icon(comparing)}Comparing with OpenIntuneBaseline</li>
    </ol>}
  </div>
}
