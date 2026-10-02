/** Shows the disclaimer for the tenants and resolves true once the admin accepted it. */
export type AcknowledgementHandler = (tenantIds: string[]) => Promise<boolean>

let handler: AcknowledgementHandler | null = null
let queue: Promise<unknown> = Promise.resolve()
// Tenants accepted in this window, so requests waiting behind the dialog do not ask again.
const accepted = new Set<string>()

/** Registered by DisclaimerHost; without it every acknowledgement is refused. */
export function setAcknowledgementHandler(next: AcknowledgementHandler | null): void {
  handler = next
}

/**
 * Asks the admin to accept the disclaimer for the tenants. Requests arriving while the
 * dialog is open wait for it, so parallel writes show one dialog instead of several.
 */
export function requestAcknowledgement(tenantIds: string[]): Promise<boolean> {
  const ask = async () => {
    const ids = tenantIds.map((id) => id.toLowerCase())
    if (ids.every((id) => accepted.has(id))) return true
    if (!handler) return false
    const ok = await handler(ids)
    if (ok) for (const id of ids) accepted.add(id)
    return ok
  }
  const result = queue.then(ask, ask)
  queue = result.catch(() => false)
  return result
}
