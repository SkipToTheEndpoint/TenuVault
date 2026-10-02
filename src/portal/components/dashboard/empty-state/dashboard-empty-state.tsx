"use client"

import { useRouter } from "next/navigation"
import { ActionCards } from "./action-cards"

export default function DashboardEmptyState() {
  const router = useRouter()

  const handleStartSetup = () => {
    router.push("/portal/onboarding")
  }

  const handleConnectExisting = () => {
    router.push("/portal/tenants?connect=1")
  }

  return (
    <div>
      <div className="container mx-auto px-4 py-8 md:py-12 space-y-6">

        
        <ActionCards 
          onStartSetup={handleStartSetup}
          onConnectExisting={handleConnectExisting}
        />
      </div>
    </div>
  )
}