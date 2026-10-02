import type { TenuVaultBridge } from "../../shared/ipc"

declare global {
  interface Window {
    tenuvault: TenuVaultBridge
  }
}

/** Main-process API exposed by the preload script. */
export const bridge: TenuVaultBridge = window.tenuvault
