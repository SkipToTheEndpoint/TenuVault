import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react"
import { ArrowLeft, Check, LoaderCircle } from "lucide-react"
import { cn } from "~/lib/utils"
import { button, card } from "./common"

/** A running stage: "Creating Defender (2 of 12)", with a bar when a count or percent is known. */
export interface Progress {
  stage: string
  done?: number
  total?: number
  percent?: number
}

export const progressText = (p: Progress) => `${p.stage}${p.total ? ` (${Math.min((p.done ?? 0) + 1, p.total)} of ${p.total})` : p.percent != null ? ` (${Math.round(p.percent)}%)` : ""}`

/**
 * When `key` changes (not on mount, unless `onMount`), scrolls `scrollTarget` (or the returned
 * element) to the top of the window and moves focus to the returned element, which needs tabIndex={-1}.
 */
export function useFocusOnChange<T extends HTMLElement>(key: unknown, scrollTarget?: RefObject<HTMLElement | null>, onMount = false) {
  const ref = useRef<T>(null)
  // The previous key, not a mount flag: StrictMode runs effects twice on mount.
  const previous = useRef<unknown>(onMount ? Symbol("mount") : key)
  useEffect(() => {
    if (Object.is(previous.current, key)) return
    previous.current = key
    ;(scrollTarget?.current ?? ref.current)?.scrollIntoView({ block: "start" })
    ref.current?.focus({ preventScroll: true })
  }, [key])
  return ref
}

export interface FlowStep {
  id: string
  label: string
}

/**
 * A multi-step workflow card: flow title, compact stepper, step heading and the step content.
 * Render an ActionBar as the last child so the actions, status and errors stay in view.
 * Completed steps are buttons when `onStep` is given and `locked` is not set.
 */
export function FlowShell({ title, steps, step, onStep, locked, heading, description, focusKey, focusOnMount, children }: {
  title: string
  steps: FlowStep[]
  step: string
  onStep?: (id: string) => void
  locked?: boolean
  /** Defaults to the current step's label. */
  heading?: ReactNode
  description?: ReactNode
  /** Scrolls to the top and focuses the heading when it changes; defaults to `step`. */
  focusKey?: unknown
  /** Also focuses the heading on mount, for example when returning to a running job. */
  focusOnMount?: boolean
  children: ReactNode
}) {
  const shell = useRef<HTMLElement>(null)
  const headingRef = useFocusOnChange<HTMLHeadingElement>(focusKey ?? step, shell, focusOnMount)
  const id = useId()
  const index = steps.findIndex(s => s.id === step)
  return <section ref={shell} aria-labelledby={id} data-flow-shell="" className={cn(card, "scroll-mt-6")}>
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <nav aria-label={`${title} steps`}><ol className="flex flex-wrap items-center gap-1 text-xs">{steps.map((s, i) => {
        const done = i < index
        const badge = <span className={cn("flex size-5 items-center justify-center rounded-full text-[11px]", i === index ? "bg-primary text-primary-foreground" : done ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500")} aria-hidden="true">{done ? <Check className="h-3 w-3" /> : i + 1}</span>
        const body = <>{badge}<span>{s.label}</span>{done && <span className="sr-only"> (completed)</span>}</>
        return <li key={s.id} className="flex items-center gap-1">
          {i > 0 && <span className="h-px w-4 bg-gray-200" aria-hidden="true" />}
          {done && onStep && !locked
            ? <button type="button" onClick={() => onStep(s.id)} className="flex items-center gap-1.5 rounded-full px-2 py-1 text-gray-700 transition-colors hover:bg-gray-100">{body}</button>
            : <span aria-current={i === index ? "step" : undefined} className={cn("flex items-center gap-1.5 rounded-full px-2 py-1", i === index ? "font-medium text-gray-900" : "text-gray-500")}>{body}</span>}
        </li>
      })}</ol></nav>
    </div>
    <h2 ref={headingRef} id={id} tabIndex={-1} className="mt-4 text-xl font-medium tracking-tight text-gray-900 outline-none">{heading ?? steps[index]?.label}</h2>
    {description && <div className="mt-2 text-sm text-gray-600">{description}</div>}
    <div className="mt-5">{children}</div>
  </section>
}

/**
 * The sticky bottom bar of a FlowShell step (or of any `card`): summary on the left, the live
 * status line or progress, errors, then Back and the actions given as children.
 * While the floating backup panel shows, the bar sticks above it instead of under it.
 */
export function ActionBar({ summary, status, error, back, children }: {
  summary?: ReactNode
  /** A string or Progress shows a spinner line; null or undefined shows nothing. */
  status?: string | Progress | null
  error?: ReactNode
  back?: { label?: string; onClick: () => void; disabled?: boolean }
  children?: ReactNode
}) {
  const bar = useRef<HTMLDivElement>(null)
  // Its height, for the scroll padding that keeps focused or scrolled-to content above it (desktop.css).
  useEffect(() => {
    const element = bar.current, root = document.documentElement
    if (!element) return
    const observer = new ResizeObserver(() => root.style.setProperty("--action-bar-height", `${element.offsetHeight}px`))
    observer.observe(element)
    return () => { observer.disconnect(); root.style.removeProperty("--action-bar-height") }
  }, [])
  const progress = typeof status === "string" ? { stage: status } : status
  const fill = progress?.percent != null ? progress.percent : progress?.total ? ((progress.done ?? 0) / progress.total) * 100 : null
  return <div ref={bar} className="sticky bottom-0 z-10 -mx-7 -mb-7 mt-6 rounded-b-3xl border-t border-gray-100 bg-white/95 px-7 py-4 backdrop-blur" style={{ bottom: "var(--floating-progress-offset, 0px)" }}>
    {error && <div role="alert" className="mb-3 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-800">{error}</div>}
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1 text-sm">
        {summary && <div className="text-gray-700">{summary}</div>}
        <div role="status" aria-live="polite">{progress && <>
          <p className="flex items-center gap-2 text-blue-700"><LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /><span className="min-w-0">{progressText(progress)}</span></p>
          {fill != null && <div className="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-gray-100" aria-hidden="true"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(2, Math.min(100, fill))}%` }} /></div>}
        </>}</div>
      </div>
      {back && <button type="button" className={button} disabled={back.disabled} onClick={back.onClick}><ArrowLeft className="h-4 w-4" aria-hidden="true" />{back.label ?? "Back"}</button>}
      {children}
    </div>
  </div>
}
