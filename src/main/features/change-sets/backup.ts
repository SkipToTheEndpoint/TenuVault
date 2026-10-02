import { backupGaps, describeMissing, describeStatus } from "../../backup/completeness"
import type { FeatureDeps } from "../deps"
import { FeatureError } from "../route"

/** Polling of the pre-change backup. Tests replace `sleep`; nothing else reads real time. */
export const BACKUP_POLLING = {
  intervalMs: 2000,
  timeoutMs: 60 * 60_000,
  sleep: (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

/**
 * Runs a full backup of the tenant through the app's own backup routes and waits for it,
 * like OpenIntuneBaseline deployments. Fails closed: any start, status or result failure throws before a single
 * tenant write, and so does a backup that is not complete (see requireCompleteBackup).
 * Returns the backup folder, which the change set records.
 */
export async function requirePreChangeBackup(deps: FeatureDeps, tenantId: string, folders: string[]): Promise<string> {
  const post = async (path: string, body: Record<string, unknown>) => {
    try {
      const response = await deps.api(path, tenantId, body)
      return { ok: response.ok, status: response.status, json: record(await response.json().catch(() => ({}))) }
    } catch (error) {
      return { ok: false, status: 502, json: { error: error instanceof Error ? error.message : String(error) } }
    }
  }
  const started = await post("/api/backup/start", {})
  if (!started.ok || typeof started.json.jobId !== "string") {
    const reason = typeof started.json.error === "string" ? ` ${started.json.error}` : ""
    throw new FeatureError(`The pre-change backup could not start, so nothing was written.${reason}`, started.status === 402 ? 402 : 502)
  }
  const deadline = deps.now().getTime() + BACKUP_POLLING.timeoutMs
  for (;;) {
    const status = await post("/api/backup/status", { jobId: started.json.jobId })
    if (!status.ok) throw new FeatureError("The pre-change backup status could not be read, so nothing was written.", 502)
    if (status.json.isComplete === true) {
      if (status.json.isSuccessful !== true || typeof status.json.backupFolder !== "string" || !status.json.backupFolder) {
        const reason = typeof status.json.exception === "string" && status.json.exception ? ` ${status.json.exception}` : ""
        throw new FeatureError(`The pre-change backup failed, so nothing was written.${reason}`, 502)
      }
      await requireCompleteBackup(status.json.backupFolder, folders, record((await post("/api/list-backup-contents", { backupId: status.json.backupFolder })).json.content).metadata)
      return status.json.backupFolder
    }
    if (deps.now().getTime() > deadline) throw new FeatureError("The pre-change backup did not finish within an hour, so nothing was written.", 504)
    await BACKUP_POLLING.sleep(BACKUP_POLLING.intervalMs)
  }
}

/**
 * Refuses a backup whose metadata.json does not show a complete result: Status Success, no
 * failures, and none of the change set's folders left out of scope, skipped or failed.
 * A backup that completed with warnings may miss exactly the objects about to change.
 */
async function requireCompleteBackup(backupFolder: string, folders: string[], metadataValue: unknown): Promise<void> {
  const gaps = backupGaps(metadataValue, folders)
  if (!gaps) throw new FeatureError(`The result of the pre-change backup ${backupFolder} could not be read, so nothing was written.`, 502)
  if (!gaps.succeeded) {
    throw new FeatureError(`The pre-change backup ${backupFolder} is not complete (${describeStatus(gaps)}), so nothing was written. Check the backup log, fix the cause and apply again.`, 502)
  }
  if (gaps.missing.length) {
    throw new FeatureError(`The pre-change backup ${backupFolder} did not collect every type this change set writes (${describeMissing(gaps)}), so nothing was written. Include those types in the backup scope, grant the missing permissions and apply again.`, 502)
  }
}
