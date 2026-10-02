/** Export formats the renderer may save through the native dialog, by file extension. */
const FORMATS = {
  csv: { label: "CSV", encoding: "utf8" },
  json: { label: "JSON", encoding: "utf8" },
  txt: { label: "Text", encoding: "utf8" },
  pdf: { label: "PDF", encoding: "base64" },
} as const

export type SaveFileFormat = keyof typeof FORMATS

/** Largest export accepted, in characters of the data sent over IPC. */
export const SAVE_FILE_LIMIT = 25_000_000

export interface PreparedFile {
  /** Sanitized file name with its extension. */
  name: string
  extension: SaveFileFormat
  label: string
  content: Buffer
}

/**
 * Checks an export sent by the renderer before the Save dialog opens: the extension picks the
 * format (CSV, JSON and text as UTF-8, PDF as base64 only), the size is capped and the file name
 * is reduced to safe characters. Throws on anything else.
 */
export function prepareSaveFile(data: unknown, fileName: unknown, encoding: unknown = "utf8"): PreparedFile {
  if (typeof data !== "string" || data.length > SAVE_FILE_LIMIT) throw new Error("The export could not be prepared.")
  const raw = typeof fileName === "string" ? fileName : ""
  const extension = raw.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()
  if (!extension || !(extension in FORMATS)) throw new Error("This file type cannot be saved.")
  const format = FORMATS[extension as SaveFileFormat]
  if (encoding !== format.encoding) throw new Error("The export could not be prepared.")
  if (format.encoding === "base64" && !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error("The export could not be prepared.")
  const content = Buffer.from(data, format.encoding)
  if (extension === "pdf" && content.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("The export could not be prepared.")
  const base = raw.slice(0, -extension.length - 1).replace(/[^\w .()-]/g, "_").trim().slice(0, 120) || "TenuVault export"
  return { name: `${base}.${extension}`, extension: extension as SaveFileFormat, label: format.label, content }
}
