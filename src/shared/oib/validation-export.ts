import type { ValidationRun } from "./types"

/** Export actual runs with their original source, timestamp and bounded comparison evidence. */
export function validationJson(runs: ValidationRun[], tenantId: string, tenantName: string, exportedAt: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "oib-policy-validation",
    tenantId,
    tenantName,
    exportedAt,
    scope: "Selected deployed policies only. Saved evidence, not a fresh tenant assessment. Difference lists may be bounded; complete root counts are available on newer runs.",
    runs: runs.filter(run => run.tenantId.toLowerCase() === tenantId.toLowerCase()),
  }, null, 2)
}
