/**
 * Stand-in for `next/cache` in the main process: `unstable_cache` becomes a small
 * in-memory cache that honours `revalidate` (seconds).
 */
export function unstable_cache<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
  keyParts: string[] = [],
  options: { revalidate?: number | false; tags?: string[] } = {},
): (...args: Args) => Promise<Result> {
  const entries = new Map<string, { expires: number; value: Promise<Result> }>()
  const ttlMs = typeof options.revalidate === "number" ? options.revalidate * 1000 : Number.POSITIVE_INFINITY

  return (...args: Args) => {
    const key = JSON.stringify([keyParts, args])
    const cached = entries.get(key)
    if (cached && cached.expires > Date.now()) return cached.value

    const value = fn(...args)
    entries.set(key, { expires: Date.now() + ttlMs, value })
    // Do not keep failures around.
    value.catch(() => entries.delete(key))
    return value
  }
}

export function revalidateTag(_tag: string): void {}
export function revalidatePath(_path: string): void {}
