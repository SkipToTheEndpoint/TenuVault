import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { loadPack, oibDownloads, oibPack, oibReleases, oibVersions, publishedReleases, resetOibSource, resolveMain, setOibCacheDir } from "../src/main/oib/source"
import { defaultSelection, oibReference, selectionLabel } from "../src/shared/oib/versions"

const MAIN = "a".repeat(40)
const V40 = "b".repeat(40)
const V38 = "c".repeat(40)
const MAC = "d".repeat(40)
const WIN = "WINDOWS/IntuneManagement/SettingsCatalog/Win - OIB - SC - Test.json"
const MACOS = "MACOS/IntuneManagement/SettingsCatalog/Mac - OIB - SC - Test.json"
const release = (tag: string, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, published_at: "2026-09-01T00:00:00Z", ...extra })
const tag = (name: string, sha: string) => ({ name, commit: { sha } })

/** GitHub with main, two Windows releases and one macOS release; `offline` fails every request. */
function github(options: { main?: string; offline?: boolean } = {}) {
  const requested: string[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    requested.push(url)
    if (options.offline) throw new TypeError("fetch failed")
    if (url.endsWith("/commits/main")) return Response.json({ sha: options.main ?? MAIN, commit: { committer: { date: "2026-09-30T00:00:00Z" } } })
    if (url.includes("/releases?")) return Response.json([
      release("windows-v3.8", { published_at: "2026-05-08T00:00:00Z" }), release("windows-v4.0", { published_at: "2026-09-30T00:00:00Z" }), release("macos-v1.0", { published_at: "2024-09-02T00:00:00Z" }),
      release("windows-v5.0", { draft: true }), release("windows-v4.1", { prerelease: true }), release("v3.2"), release("win365-v1.0"),
    ])
    if (url.includes("/tags?")) return Response.json([tag("windows-v4.0", V40), tag("windows-v3.8", V38), tag("macos-v1.0", MAC), tag("v3.2", "e".repeat(40)), tag("windows-v5.0", "f".repeat(40))])
    if (url.includes("/git/trees/")) return Response.json({ truncated: false, tree: [{ type: "blob", path: WIN }, { type: "blob", path: MACOS }, { type: "blob", path: "README.md" }] })
    if (url.startsWith("https://raw.githubusercontent.com/")) return Response.json({ name: url.includes("MACOS") ? "Mac - OIB - SC - Test" : "Win - OIB - SC - Test", settings: [] })
    throw new Error(`Unexpected source: ${url}`)
  })
  vi.stubGlobal("fetch", fetcher)
  return { fetcher, requested }
}

let dir: string | null = null
beforeEach(() => { resetOibSource(); setOibCacheDir(null) })
afterEach(() => {
  vi.unstubAllGlobals()
  setOibCacheDir(null)
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})
const useCache = () => { dir = mkdtempSync(join(tmpdir(), "oib-cache-")); setOibCacheDir(dir); return dir }

it("lists stable platform releases pinned to their tag commits, newest first", () => {
  const releases = publishedReleases([
    release("windows-v3.8", { published_at: "2026-05-08T00:00:00Z" }), release("windows-v4.0", { published_at: "2026-09-30T00:00:00Z" }),
    release("windows-v5.0", { draft: true }), release("windows-v4.1", { prerelease: true }), release("v3.2"), release("../../main"),
    release("windows-v3.9", { published_at: null }), release("byod-v1.0"),
  ], [tag("windows-v4.0", V40), tag("windows-v3.8", V38), tag("windows-v5.0", V40), tag("v3.2", V38), tag("windows-v3.9", V38), tag("byod-v1.0", "not-a-sha")])
  // byod-v1.0 has no valid commit and is left out, like drafts, prereleases and unprefixed tags.
  expect(releases).toEqual([
    { platform: "windows", tag: "windows-v4.0", commit: V40, publishedAt: "2026-09-30T00:00:00Z" },
    { platform: "windows", tag: "windows-v3.8", commit: V38, publishedAt: "2026-05-08T00:00:00Z" },
  ])
  expect(() => publishedReleases({}, [])).toThrow("unexpected release listing")
})

it("resolves main and every release in three GitHub calls and caches them", async () => {
  const { fetcher } = github()
  const versions = await oibVersions()
  expect(versions.main).toEqual({ commit: MAIN, committedAt: "2026-09-30T00:00:00Z" })
  expect(versions.releases.map(r => r.tag)).toEqual(["windows-v4.0", "windows-v3.8", "macos-v1.0"])
  await oibVersions()
  expect(fetcher).toHaveBeenCalledTimes(3)
  expect(defaultSelection(versions, "windows")).toEqual({ commit: V40, tag: "windows-v4.0" })
  expect(defaultSelection(versions, "byod")).toEqual({ commit: MAIN })
  expect(selectionLabel(defaultSelection(versions, "windows"))).toBe("v4.0")
  expect(selectionLabel(defaultSelection(versions, "byod"))).toBe(`main @ ${MAIN.slice(0, 7)}`)
})

it("loads a release only for its own platform and tag, and labels it with the tag", async () => {
  github()
  await expect(loadPack("windows", V40, "windows-v4.0")).rejects.toThrow("Reload")
  await oibVersions()
  const pack = await loadPack("windows", V40, "windows-v4.0")
  expect(pack.catalog).toMatchObject({ commit: V40, tag: "windows-v4.0", reference: `OpenIntuneBaseline Windows v4.0 · windows-v4.0 @ ${V40.slice(0, 7)}` })
  await expect(loadPack("macos", V40, "windows-v4.0")).rejects.toThrow("Reload")
  await expect(loadPack("windows", V40, "windows-v3.8")).rejects.toThrow("Reload")
  await expect(loadPack("windows", V40, 42)).rejects.toThrow("Reload")
  await expect(loadPack("windows", "e".repeat(40))).rejects.toThrow("Reload")
  // Without a tag, a release commit reads as its release (the baseline features pass commits only).
  expect((await loadPack("windows", V38)).catalog.reference).toContain("windows-v3.8 @")
  expect((await loadPack("windows", MAIN)).catalog.reference).toBe(`OpenIntuneBaseline Windows · main @ ${MAIN.slice(0, 7)}`)
})

it("names a release commit after its release, and downloads it once for every label", async () => {
  const { requested } = github({ main: V40 })
  await oibVersions()
  const [untagged, tagged] = await Promise.all([loadPack("windows", V40), loadPack("windows", V40, "windows-v4.0")])
  // Main and the release share the commit, so the files are the release's.
  expect(untagged.catalog.reference).toContain("· windows-v4.0 @")
  expect(tagged.catalog.reference).toContain("· windows-v4.0 @")
  expect((await oibPack("windows", V40, "windows-v4.0")).reference).toContain("· windows-v4.0 @")
  expect(requested.filter(url => url.startsWith("https://raw.githubusercontent.com/"))).toHaveLength(1)
  expect((await loadPack("macos", V40)).catalog.reference).toContain("macOS · main @")
})

it("lists the repository once per commit and downloads a pack once for concurrent loads", async () => {
  const { requested } = github()
  await oibVersions()
  await Promise.all([loadPack("windows", MAIN), loadPack("windows", MAIN), loadPack("macos", MAIN)])
  expect(requested.filter(url => url.includes("/git/trees/"))).toHaveLength(1)
  expect(requested.filter(url => url.includes(encodeURIComponent("Win - OIB - SC - Test.json")))).toHaveLength(1)
  expect(oibDownloads()).toEqual([])
})

it("reuses packs from disk after a restart and works offline with the last known versions", async () => {
  const cache = useCache()
  github()
  await oibVersions()
  await loadPack("windows", V40, "windows-v4.0")
  expect(readdirSync(join(cache, "packs"))).toEqual([`${V40}-windows.json`])

  resetOibSource()
  const { requested } = github({ offline: true })
  const versions = await oibVersions()
  expect(versions.warning).toContain("Showing the versions known on")
  expect(versions.releases.map(r => r.tag)).toEqual(["windows-v4.0", "windows-v3.8", "macos-v1.0"])
  const requestsBefore = requested.length
  const pack = await loadPack("windows", V40, "windows-v4.0")
  expect(pack.catalog.policies).toHaveLength(1)
  expect(requested).toHaveLength(requestsBefore)
  // Not on disk and GitHub unreachable: a clear failure, not a partial pack.
  await expect(loadPack("macos", MAC, "macos-v1.0")).rejects.toThrow()
})

it("downloads again when a cached pack is damaged", async () => {
  const cache = useCache()
  github()
  await oibVersions()
  await loadPack("windows", MAIN)
  writeFileSync(join(cache, "packs", `${MAIN}-windows.json`), JSON.stringify({ format: 1, platform: "windows", commit: MAIN, files: [{ path: WIN, json: "not a policy" }], manifest: null }))
  resetOibSource()
  const { requested } = github()
  await oibVersions()
  expect((await loadPack("windows", MAIN)).catalog.policies).toHaveLength(1)
  expect(requested.some(url => url.startsWith("https://raw.githubusercontent.com/"))).toBe(true)
})

it("fails without GitHub and without stored versions, and retries on the next call", async () => {
  github({ offline: true })
  await expect(oibVersions()).rejects.toThrow("fetch failed")
  github()
  expect((await oibVersions()).main.commit).toBe(MAIN)
})

it("reuses the offline versions briefly instead of retrying GitHub on every request", async () => {
  useCache()
  github()
  await oibVersions()
  resetOibSource()
  const { fetcher } = github({ offline: true })
  await oibVersions()
  const calls = fetcher.mock.calls.length
  await oibVersions()
  expect(fetcher.mock.calls.length).toBe(calls)
  // An explicit retry asks GitHub again.
  github()
  expect((await oibVersions(true)).warning).toBeUndefined()
})

it("offers each platform's latest release as its upgrade, and main where none is published", async () => {
  github()
  const { releases, warning } = await oibReleases()
  expect(warning).toBeUndefined()
  expect(releases.find(r => r.platform === "windows")).toMatchObject({ tag: "windows-v4.0", commit: V40, reference: oibReference("windows", V40, "windows-v4.0"), publishedAt: "2026-09-30T00:00:00Z" })
  expect(releases.find(r => r.platform === "byod")).toMatchObject({ tag: `main @ ${MAIN.slice(0, 7)}`, commit: MAIN, reference: `OpenIntuneBaseline BYOD · main @ ${MAIN.slice(0, 7)}` })
})

it("resolves releases on demand for the baseline features", async () => {
  github()
  expect((await oibPack("windows", V38)).reference).toContain("windows-v3.8 @")
  await expect(oibPack("windows", "e".repeat(40))).rejects.toThrow("Reload")
  await resolveMain()
})
