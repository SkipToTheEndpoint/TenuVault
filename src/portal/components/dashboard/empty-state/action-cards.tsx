"use client"

import { Building2 } from "lucide-react"
import { Button } from "~/components/ui/button"

interface ActionCardsProps {
  onStartSetup: () => void
  onConnectExisting: () => void
}

export function ActionCards({ onStartSetup, onConnectExisting }: ActionCardsProps) {
  return <div className="mx-auto max-w-2xl rounded-xl border border-gray-200 bg-white p-6">
    <Building2 className="mb-4 h-8 w-8 text-blue-600" />
    <h2 className="text-2xl font-semibold text-gray-900">Protect your Intune policies</h2>
    <p className="mt-3 text-gray-600">Connect a tenant to back up policies, restore unassigned copies, and compare snapshots for drift. During setup, choose encrypted storage on this computer or your own Azure storage account. Local backups need no Azure resources.</p>
    <div className="mt-6 flex flex-wrap gap-3">
      <Button onClick={onConnectExisting}>Connect tenant</Button>
      <Button variant="outline" onClick={onStartSetup}>Guided setup</Button>
    </div>
  </div>
}
