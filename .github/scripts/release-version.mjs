/**
 * Decides the version and tag of a release from the repository's tags.
 *
 *   node .github/scripts/release-version.mjs nightly <package version> <YYYYMMDDHHMMSS, UTC> [tags...]
 *   node .github/scripts/release-version.mjs stable <version>
 *
 * Nightlies preview the next stable version: the package version while it has not shipped
 * yet, otherwise the patch after the newest stable tag. The build time is one fixed width number,
 * so nightlies sort the same by number and by text: GitHub lists releases by tag text, and a run
 * number going from 9 to 10 put the newest nightly at the bottom of the release page.
 * Prints JSON: { version, tag, prerelease }.
 */

const STABLE = /^v(\d+)\.(\d+)\.(\d+)$/

export function nextNightly(packageVersion, timestamp, tags) {
  if (!/^\d+\.\d+\.\d+$/.test(packageVersion)) throw new Error(`Invalid package version ${packageVersion}`)
  if (!/^2\d{13}$/.test(String(timestamp))) throw new Error(`Invalid build time ${timestamp}, expected YYYYMMDDHHMMSS`)
  const stable = tags
    .map((tag) => STABLE.exec(tag))
    .filter(Boolean)
    .map((m) => m.slice(1, 4).map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
    .pop()
  const pkg = packageVersion.split(".").map(Number)
  const shipped = stable && (stable[0] > pkg[0] || (stable[0] === pkg[0] && (stable[1] > pkg[1] || (stable[1] === pkg[1] && stable[2] >= pkg[2]))))
  const base = shipped ? `${stable[0]}.${stable[1]}.${stable[2] + 1}` : packageVersion
  const version = `${base}-nightly.${timestamp}`
  return { version, tag: `v${version}`, prerelease: true }
}

export function stable(version) {
  const clean = String(version).replace(/^v/, "")
  if (!/^\d+\.\d+\.\d+$/.test(clean)) throw new Error(`A stable version looks like 1.2.3, not ${version}`)
  return { version: clean, tag: `v${clean}`, prerelease: false }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [channel, ...args] = process.argv.slice(2)
  const result = channel === "nightly" ? nextNightly(args[0], args[1], args.slice(2)) : stable(args[0])
  console.log(JSON.stringify(result))
}
