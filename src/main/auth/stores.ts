import type { ICachePlugin } from "@azure/msal-node"
import type { SignedInAccount } from "../../shared/ipc"
import type { SecureStore } from "../storage/secure-store"
import type { AuthHost } from "./msal"

/** MSAL token cache for one client id, persisted in the encrypted token store. */
export function secureCachePlugin(store: SecureStore, clientId: string): ICachePlugin {
  const key = `msal.${clientId}`
  return {
    beforeCacheAccess: async (context) => {
      const serialized = store.get(key)
      if (serialized) context.tokenCache.deserialize(serialized)
    },
    afterCacheAccess: async (context) => {
      if (context.cacheHasChanged) store.set(key, context.tokenCache.serialize())
    },
  }
}

type StoredAccount = SignedInAccount & { homeAccountId: string }

const PREFIX = "auth.account."

export function accountStore(store: SecureStore): AuthHost["accountStore"] {
  return {
    get: (tenantId) => {
      const raw = store.get(PREFIX + tenantId.toLowerCase())
      return raw ? (JSON.parse(raw) as StoredAccount) : null
    },
    set: (account) => store.set(PREFIX + account.tenantId.toLowerCase(), JSON.stringify(account)),
    delete: (tenantId) => store.delete(PREFIX + tenantId.toLowerCase()),
    list: () =>
      store
        .keys()
        .filter((key) => key.startsWith(PREFIX))
        .map((key) => {
          const { homeAccountId: _homeAccountId, ...account } = JSON.parse(store.get(key)!) as StoredAccount
          return account
        }),
  }
}
