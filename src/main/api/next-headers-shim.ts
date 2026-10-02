/**
 * Stand-in for `next/headers` in the main process. Requests come from the local
 * app, so there is no client IP; audit entries record the desktop app instead.
 */
export async function headers(): Promise<Headers> {
  return new Headers({ "user-agent": "TenuVault Desktop", "x-real-ip": "local" })
}
