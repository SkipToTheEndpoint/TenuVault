import { OIB_PLATFORMS, type OibPlatform, type OibPublishedRelease, type OibSelection, type OibVersions } from "./types"

/** Upstream release tags name their platform: windows-v4.0, macos-v1.0, win365-v1.0, byod-v1.0. */
export const RELEASE_TAG = /^(windows|macos|win365|byod)-v(\d+(?:\.\d+){0,3})$/i

/** The platform a release tag belongs to, or undefined for tags that are not platform releases. */
export function tagPlatform(tag: string): OibPlatform | undefined {
  return RELEASE_TAG.exec(tag)?.[1]!.toLowerCase() as OibPlatform | undefined
}

/** "v4.0" for windows-v4.0. */
export function tagVersion(tag: string): string | undefined {
  const version = RELEASE_TAG.exec(tag)?.[2]
  return version ? `v${version}` : undefined
}

/** The published releases of a platform, newest first. */
export function platformReleases(versions: OibVersions, platform: OibPlatform): OibPublishedRelease[] {
  return versions.releases.filter((release) => release.platform === platform)
}

/** The version a platform uses unless the admin picks another: its newest release, else main. */
export function defaultSelection(versions: OibVersions, platform: OibPlatform): OibSelection {
  const latest = platformReleases(versions, platform)[0]
  return latest ? { commit: latest.commit, tag: latest.tag } : { commit: versions.main.commit }
}

/** Short label for a selection: "v4.0" for a release, "main @ 1cc71a9" otherwise. */
export function selectionLabel(selection: OibSelection): string {
  return selection.tag ? tagVersion(selection.tag) ?? selection.tag : `main @ ${selection.commit.slice(0, 7)}`
}

/**
 * The reference recorded with runs, comparisons and baselines, for example
 * "OpenIntuneBaseline Windows v4.0 · windows-v4.0 @ 1cc71a9" or "OpenIntuneBaseline macOS · main @ 1cc71a9".
 */
export function oibReference(platform: OibPlatform, commit: string, tag?: string, manifestVersion?: string): string {
  const version = (tag && tagVersion(tag)) ?? manifestVersion
  return `OpenIntuneBaseline ${OIB_PLATFORMS[platform].label}${version ? ` ${version}` : ""} · ${tag ?? "main"} @ ${commit.slice(0, 7)}`
}
