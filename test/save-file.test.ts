import { describe, expect, it } from "vitest"
import { prepareSaveFile, SAVE_FILE_LIMIT } from "../src/main/save-file"

describe("prepareSaveFile", () => {
  it("keeps CSV and JSON as UTF-8 and names the filter", () => {
    const csv = prepareSaveFile("a,b\n1,2", "OIB validation Contoso 2026-10-01.csv")
    expect(csv).toMatchObject({ name: "OIB validation Contoso 2026-10-01.csv", extension: "csv", label: "CSV" })
    expect(csv.content.toString("utf8")).toBe("a,b\n1,2")
    expect(prepareSaveFile("{}", "export.JSON")).toMatchObject({ name: "export.json", extension: "json", label: "JSON" })
  })

  it("reduces the file name to safe characters", () => {
    expect(prepareSaveFile("x", "../../etc/pass:wd*.csv").name).toBe(".._.._etc_pass_wd_.csv")
    expect(prepareSaveFile("x", ".csv").name).toBe("TenuVault export.csv")
    expect(prepareSaveFile("x", `${"a".repeat(300)}.txt`).name).toBe(`${"a".repeat(120)}.txt`)
  })

  it("accepts a PDF only as base64 with a PDF header", () => {
    const data = Buffer.from("%PDF-1.7 test").toString("base64")
    expect(prepareSaveFile(data, "report.pdf", "base64").content.toString("latin1")).toBe("%PDF-1.7 test")
    expect(() => prepareSaveFile(data, "report.pdf")).toThrow()
    expect(() => prepareSaveFile(Buffer.from("<html>").toString("base64"), "report.pdf", "base64")).toThrow()
    expect(() => prepareSaveFile("not base64!", "report.pdf", "base64")).toThrow()
    expect(() => prepareSaveFile("a,b", "report.csv", "base64")).toThrow()
  })

  it("refuses other types, missing extensions, non-strings and oversized data", () => {
    expect(() => prepareSaveFile("x", "run.exe")).toThrow("This file type cannot be saved.")
    expect(() => prepareSaveFile("x", "noextension")).toThrow("This file type cannot be saved.")
    expect(() => prepareSaveFile("x", 42)).toThrow()
    expect(() => prepareSaveFile(42, "a.csv")).toThrow()
    expect(() => prepareSaveFile("x".repeat(SAVE_FILE_LIMIT + 1), "a.csv")).toThrow()
  })
})
