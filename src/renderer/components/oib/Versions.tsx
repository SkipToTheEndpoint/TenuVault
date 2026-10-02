import { createContext, useContext, useState } from "react"
import { cn } from "~/lib/utils"
import { OIB_PLATFORMS, type OibPlatform, type OibVersions } from "../../../shared/oib/types"
import { defaultSelection, platformReleases } from "../../../shared/oib/versions"
import { button, platformsLabel, primary, VersionPicker, versionsLabel, type Selections } from "./common"

const ALL = Object.keys(OIB_PLATFORMS) as OibPlatform[]

/** The versions chosen on the OpenIntuneBaseline page; `choose` applies new ones (the open workflow restarts). */
export interface OibVersionChoice {
  versions: OibVersions
  selections: Selections
  choose: (value: Selections) => void
}

export const VersionsContext = createContext<OibVersionChoice | null>(null)

/** "Windows v4.0, macOS v1.0 and BYOD main" for the platforms given (all when empty). */
export const selectionsLabel = (selections: Selections, platforms: OibPlatform[] = []) =>
  versionsLabel((platforms.length ? platforms : ALL).map(platform => ({ platform, tag: selections[platform].tag })))

/** Plain notes about main: unreleased changes where releases exist, and platforms without a release yet. */
export function mainNotes(versions: OibVersions, selections: Selections, platforms: OibPlatform[] = []) {
  const onMain = (platforms.length ? platforms : ALL).filter(p => !selections[p].tag)
  // Main is flagged only when it differs from every release of a platform that has releases.
  const unreleased = onMain.filter(p => platformReleases(versions, p).length && !platformReleases(versions, p).some(r => r.commit === selections[p].commit))
  const only = onMain.filter(p => !platformReleases(versions, p).length)
  return {
    warning: unreleased.length ? `${platformsLabel(unreleased)} ${unreleased.length === 1 ? "uses" : "use"} main, which can hold changes that are not released yet. Test in a pilot tenant first.` : "",
    info: only.length ? `${platformsLabel(only)}: main (no published release yet).` : "",
  }
}

/** Version selects with Use latest releases, Cancel and Done; nothing applies before Done. */
export function VersionsPanel({ versions, selections, onDone, onCancel, className }: { versions: OibVersions; selections: Selections; onDone: (value: Selections) => void; onCancel: () => void; className?: string }) {
  const [draft, setDraft] = useState(selections)
  return <div className={cn("rounded-2xl border border-gray-200 bg-white p-5", className)} role="group" aria-label="OpenIntuneBaseline versions">
    <p className="mb-4 text-sm text-gray-600">Each platform uses its latest published release unless you choose another. Older releases have fewer or older policies; main includes changes that are not released yet. Platforms without a published release use main.</p>
    <VersionPicker versions={versions} value={draft} onChange={setDraft} />
    <div className="mt-4 flex flex-wrap justify-end gap-3">
      <button type="button" className={button} onClick={() => setDraft(Object.fromEntries(ALL.map(p => [p, defaultSelection(versions, p)])) as Selections)}>Use latest releases</button>
      <button type="button" className={button} onClick={onCancel}>Cancel</button>
      <button type="button" className={primary} onClick={() => onDone(draft)}>Done</button>
    </div>
  </div>
}

/**
 * The versions a workflow uses, with an inline Change versions for its first step (before anything
 * is loaded). Applying new versions restarts the workflow at its first step.
 */
export function ChangeVersions({ platforms = [], disabled }: { platforms?: OibPlatform[]; disabled?: boolean }) {
  const choice = useContext(VersionsContext)
  const [open, setOpen] = useState(false)
  if (!choice) return null
  const { versions, selections, choose } = choice
  const notes = mainNotes(versions, selections, platforms)
  return <div className="mt-5 text-sm text-gray-600">
    <p>Versions: {selectionsLabel(selections, platforms)}.{" "}
      {!open && <button type="button" className="text-blue-700 underline disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled} onClick={() => setOpen(true)}>Change versions</button>}
    </p>
    {notes.info && <p className="mt-1 text-xs text-gray-500">{notes.info}</p>}
    {notes.warning && <p role="status" className="mt-1 text-xs text-amber-900">{notes.warning}</p>}
    {open && <VersionsPanel className="mt-3" versions={versions} selections={selections} onCancel={() => setOpen(false)} onDone={value => { setOpen(false); choose(value) }} />}
  </div>
}
