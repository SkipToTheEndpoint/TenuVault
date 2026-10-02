import { describe, expect, it } from "vitest"

// The release workflow runs this script with plain Node.
const load = async () => (await import("../.github/scripts/release-version.mjs" as string)) as {
  nextNightly: (pkg: string, timestamp: string, tags: string[]) => { version: string; tag: string; prerelease: boolean }
  stable: (version: string) => { version: string; tag: string; prerelease: boolean }
}

describe("release versions", () => {
  it("previews the package version until it ships, then the next patch", async () => {
    const { nextNightly } = await load()
    expect(nextNightly("0.1.0", "20260926181500", [])).toEqual({ version: "0.1.0-nightly.20260926181500", tag: "v0.1.0-nightly.20260926181500", prerelease: true })
    expect(nextNightly("0.1.0", "20260926181500", ["v0.1.0", "v0.1.0-nightly.20260925.40"]).version).toBe("0.1.1-nightly.20260926181500")
    expect(nextNightly("0.1.0", "20260926181500", ["v0.1.2", "v0.1.10", "v0.1.9"]).version).toBe("0.1.11-nightly.20260926181500")
    expect(nextNightly("0.2.0", "20260926181500", ["v0.1.3"]).version).toBe("0.2.0-nightly.20260926181500")
    expect(() => nextNightly("0.1.0", "20260926", [])).toThrow()
  })

  it("orders nightlies the same by text as by build time", async () => {
    const { nextNightly } = await load()
    const tags = ["20260926090000", "20260926100000", "20261001000000"].map((time) => nextNightly("0.1.0", time, []).tag)
    expect([...tags].sort()).toEqual(tags)
    // Newer than the nightlies numbered by run, by text and for the updater.
    expect(tags[0]! > "v0.1.0-nightly.20260926.9").toBe(true)
  })

  it("accepts only plain versions for stable releases", async () => {
    const { stable } = await load()
    expect(stable("v0.1.0")).toEqual({ version: "0.1.0", tag: "v0.1.0", prerelease: false })
    expect(() => stable("0.1.0-nightly.1")).toThrow()
    expect(() => stable("main")).toThrow()
  })
})
