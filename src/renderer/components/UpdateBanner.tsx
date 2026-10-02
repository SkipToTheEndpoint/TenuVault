import { useEffect, useState } from "react"
import { Download } from "lucide-react"
import { Button } from "~/components/ui/button"
import type { UpdateStatus } from "../../shared/ipc"
import { bridge } from "../lib/bridge"

/** Offers a restart once an update has downloaded in the background. */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" })
  useEffect(() => {
    void bridge.updates.status().then(setStatus)
    return bridge.updates.onChanged(setStatus)
  }, [])
  if (status.state !== "ready") return null
  return (
    <div className="px-6 pt-5 lg:px-8">
      <div className="flex items-center gap-3 rounded-3xl bg-card py-2 pl-2 pr-2 text-sm text-gray-900 shadow-[0_1px_2px_rgba(22,21,20,0.04)]">
        <span className="flex size-9 flex-shrink-0 items-center justify-center rounded-full bg-coral-500 text-white" aria-hidden="true">
          <Download className="h-4 w-4" />
        </span>
        <p className="flex-1">TenuVault {status.version} is ready. It installs the next time TenuVault restarts.</p>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => void bridge.updates.install()}>
          Restart now
        </Button>
      </div>
    </div>
  )
}
