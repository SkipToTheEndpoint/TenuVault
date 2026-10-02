import { createHash, randomBytes } from "node:crypto"
import type { KeyValueStore } from "../storage/secure-store"

const KEYRING = "backup.keyring"
const RECOVERY_PREFIX = "TVK1."
const BUNDLE_PREFIX = "TVK2."

/**
 * Encryption keys for backups stored on this device.
 *
 * The master key is random and lives in the app's encrypted store (DPAPI / Keychain).
 * Admins can export the entire keyring as a versioned recovery bundle to read the backups on another device or
 * after reinstalling. Importing a recovery key makes it the current key and keeps the
 * previous ones, so no existing backup becomes unreadable.
 */
export class BackupKeys {
  constructor(private readonly store: KeyValueStore) {}

  /** Current key first. Creates the first key on demand. */
  keyring(): Buffer[] {
    const stored = this.read()
    if (stored.length > 0) return stored
    const key = randomBytes(32)
    this.write([key])
    return [key]
  }

  exportRecoveryKey(): string {
    return BUNDLE_PREFIX + this.keyring().map((key) => key.toString("base64url")).join(".")
  }

  importRecoveryKey(recoveryKey: string): void {
    const trimmed = recoveryKey.trim()
    const encoded = trimmed.startsWith(BUNDLE_PREFIX)
      ? trimmed.slice(BUNDLE_PREFIX.length).split(".")
      : trimmed.startsWith(RECOVERY_PREFIX) ? [trimmed.slice(RECOVERY_PREFIX.length)] : []
    // Buffer's decoder accepts malformed base64. Require a canonical 32-byte key.
    if (encoded.length === 0 || encoded.some((value) =>
      !/^[A-Za-z0-9_-]{43}$/.test(value) || Buffer.from(value, "base64url").toString("base64url") !== value,
    )) {
      throw new Error("This is not a TenuVault recovery key. Use a TVK2 bundle or a legacy TVK1 key.")
    }
    const keys = [...new Set([...encoded, ...this.read().map((key) => key.toString("base64url"))])]
    this.write(keys.map((key) => Buffer.from(key, "base64url")))
  }

  /** Short, non-secret identifier so admins can tell keys apart. */
  fingerprint(): string {
    return createHash("sha256").update(this.keyring()[0]!).digest("hex").slice(0, 12).toUpperCase().replace(/(.{4})(?!$)/g, "$1-")
  }

  private read(): Buffer[] {
    try {
      const parsed: unknown = JSON.parse(this.store.get(KEYRING) ?? "[]")
      return Array.isArray(parsed) ? parsed.map((k) => Buffer.from(String(k), "base64")).filter((k) => k.length === 32) : []
    } catch {
      return []
    }
  }

  private write(keys: Buffer[]): void {
    this.store.set(KEYRING, JSON.stringify(keys.map((k) => k.toString("base64"))))
  }
}
