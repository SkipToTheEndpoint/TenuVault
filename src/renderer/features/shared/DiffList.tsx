import type { DiffEntry } from "./change-set"

/** A bounded list of configuration differences; values are shortened, never secrets. */
export function DiffList({ entries, truncated }: { entries: DiffEntry[]; truncated?: boolean }) {
  if (!entries.length) return <p className="text-sm text-gray-500">No configuration differences.</p>
  return (
    <div className="space-y-1">
      <ul className="max-h-72 space-y-1 overflow-y-auto rounded-2xl bg-gray-50 p-3 font-mono text-xs dark:bg-gray-900">
        {entries.map((entry, index) => (
          <li key={index} className="break-all">
            <span className={entry.change === "added" ? "text-green-700 dark:text-green-400" : entry.change === "removed" ? "text-red-700 dark:text-red-400" : "text-amber-800 dark:text-amber-300"}>
              {entry.change === "added" ? "added" : entry.change === "removed" ? "removed" : "changed"}
            </span>{" "}
            <span className="text-gray-800 dark:text-gray-200">{entry.path}</span>
            {entry.before !== undefined && <span className="text-gray-500">: {entry.before}</span>}
            {entry.after !== undefined && <span className="text-gray-700 dark:text-gray-300">{entry.before !== undefined ? " to " : ": "}{entry.after}</span>}
          </li>
        ))}
      </ul>
      {truncated && <p className="text-xs text-gray-500">More differences exist than are listed here.</p>}
    </div>
  )
}
