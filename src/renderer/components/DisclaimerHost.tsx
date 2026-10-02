import { useCallback, useEffect, useRef, useState } from "react"
import { ShieldAlert } from "lucide-react"
import { Button } from "~/components/ui/button"
import { Checkbox } from "~/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog"
import { useTenants } from "~/contexts/TenantContext"
import { DISCLAIMER_CONFIRMATIONS, DISCLAIMER_PARAGRAPHS, DISCLAIMER_TITLE } from "../../shared/disclaimer"
import { bridge } from "../lib/bridge"
import { setAcknowledgementHandler } from "../lib/disclaimer"

interface Pending {
  tenantIds: string[]
  resolve: (accepted: boolean) => void
}

/**
 * Shows the disclaimer whenever the main process refuses a tenant change because the tenant
 * has not accepted it yet (see lib/fetch-bridge.ts). It cannot be dismissed: the admin either
 * accepts it after reading to the end and ticking every confirmation, or cancels the change.
 */
export function DisclaimerHost() {
  const tenants = useTenants()
  const [pending, setPending] = useState<Pending | null>(null)
  const [read, setRead] = useState(false)
  const [confirmed, setConfirmed] = useState<boolean[]>(() => DISCLAIMER_CONFIRMATIONS.map(() => false))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setAcknowledgementHandler((tenantIds) => new Promise<boolean>((resolve) => {
      setRead(false)
      setConfirmed(DISCLAIMER_CONFIRMATIONS.map(() => false))
      setError(null)
      setPending({ tenantIds, resolve })
    }))
    return () => setAcknowledgementHandler(null)
  }, [])

  // Text that fits without scrolling counts as read.
  const checkRead = useCallback(() => {
    const box = scrollRef.current
    if (box && box.scrollTop + box.clientHeight >= box.scrollHeight - 8) setRead(true)
  }, [])
  useEffect(() => {
    if (pending) requestAnimationFrame(checkRead)
  }, [pending, checkRead])

  const finish = (accepted: boolean) => {
    pending?.resolve(accepted)
    setPending(null)
  }

  const accept = async () => {
    if (!pending) return
    setSaving(true)
    setError(null)
    try {
      await bridge.disclaimer.accept(pending.tenantIds)
      finish(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "The acceptance could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  const names = pending?.tenantIds.map((id) => tenants.find((tenant) => tenant.credentials?.tenantId?.toLowerCase() === id)?.name ?? id) ?? []
  const ready = read && confirmed.every(Boolean) && !saving

  return (
    <Dialog open={!!pending}>
      <DialogContent
        hideClose
        className="max-w-2xl"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <ShieldAlert className="h-5 w-5 text-amber-600" aria-hidden="true" />
            {DISCLAIMER_TITLE}
          </DialogTitle>
          <DialogDescription>
            Read and accept this once for {names.length === 1 ? "the tenant" : "each of these tenants"} before TenuVault changes {names.length === 1 ? "it" : "them"}:{" "}
            <strong className="text-gray-900 dark:text-gray-100">{names.join(", ")}</strong>
          </DialogDescription>
        </DialogHeader>
        <div
          ref={scrollRef}
          onScroll={checkRead}
          className="max-h-[45vh] space-y-3 overflow-y-auto rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
        >
          {DISCLAIMER_PARAGRAPHS.map((paragraph, index) => (
            <p key={index} className={index === DISCLAIMER_PARAGRAPHS.length - 1 ? "font-semibold" : undefined}>{paragraph}</p>
          ))}
        </div>
        <div className="space-y-2 text-sm">
          {DISCLAIMER_CONFIRMATIONS.map((text, index) => (
            <label key={index} className={`flex items-start gap-2 ${read ? "text-gray-900 dark:text-gray-100" : "text-gray-400"}`}>
              <Checkbox
                className="mt-0.5"
                disabled={!read}
                checked={confirmed[index]}
                onCheckedChange={(checked) => setConfirmed((current) => current.map((value, i) => (i === index ? checked === true : value)))}
              />
              <span>{text}</span>
            </label>
          ))}
          {!read && <p className="text-xs text-gray-500">Scroll to the end of the text to continue.</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={() => finish(false)}>Cancel change</Button>
          <Button type="button" disabled={!ready} onClick={() => void accept()}>
            {saving ? "Saving" : "Accept and continue"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
