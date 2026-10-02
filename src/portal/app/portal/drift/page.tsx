"use client"

import { useState, useEffect, useRef } from "react"
import { useTenants, useSelectedTenant } from "~/contexts/TenantContext"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog"
import { 
  GitCompare,
  AlertTriangle,
  Info,
  Clock,
  Download,
  Play,
  Settings,
  TrendingUp,
  User,
  FileText,
  Shield,
  Smartphone,
  Package,
  RefreshCw,
  Eye,
  Check,
  X,
  ArrowUpRight,
  GitBranch,
  Activity,
  BarChart3,
  Bell,
  Mail,
  Webhook,
  Plus,
  Edit,
  Building2,
  Loader2,
  FileJson,
  FileSpreadsheet,
  ChevronDown
} from "lucide-react"
import { cn } from "~/lib/utils"
import { useTenantPlan } from "@desktop/lib/license"
import { GatedButton } from "@desktop/components/PlanGate"
import { Button } from "~/components/ui/button"
import { Alert, AlertDescription } from "~/components/ui/alert"
import { RevertProgressModal } from "~/components/drift/revert-progress-modal"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"

interface Drift {
  id: string
  tenant: string
  tenantId: string
  severity: "critical" | "warning" | "info"
  type: string
  configName: string
  configId: string
  changeType: "added" | "modified" | "deleted"
  detectedAt: string
  fromBackup: string // Now contains the actual backup folder name
  toBackup: string // Now contains the actual backup folder name
  fromBackupTimestamp?: string // Timestamp for display purposes
  toBackupTimestamp?: string // Timestamp for display purposes
  description: string
  impact: string
  affectedPolicies: number
  affectedDevices: number
  comparisonIndex?: number
  revertHistory?: Array<{
    timestamp: string
    action: "revert" | "restore"
  }>
  lastRevertedAt?: string
  isRevertDrift?: boolean
  revertTimestamp?: string
  backupFile?: string
  changes?: {
    field: string
    oldValue: any
    newValue: any
  }[]
}

interface DriftSummary {
  total: number
  critical: number
  warning: number
  info: number
  affectedTenants: number
}

export default function DriftDetectionPage() {
  const scanRequest = useRef<AbortController | null>(null)
  const tenants = useTenants()
  const { selectedTenant } = useSelectedTenant()
  const plan = useTenantPlan(selectedTenant?.credentials?.tenantId)
  const [selectedDrift, setSelectedDrift] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<"list" | "timeline" | "analysis">("list")
  const [isLoading, setIsLoading] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [loadingMessage, setLoadingMessage] = useState("")
  const [error, setError] = useState("")
  const [drifts, setDrifts] = useState<Drift[]>([])
  const [summary, setSummary] = useState<DriftSummary>({
    total: 0,
    critical: 0,
    warning: 0,
    info: 0,
    affectedTenants: 0
  })
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [backupsAnalyzed, setBackupsAnalyzed] = useState(0)
  const [revertingDriftId, setRevertingDriftId] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean
    driftId: string
    action: "revert" | "restore"
    title: string
    message: string
  } | null>(null)
  const [progressModal, setProgressModal] = useState<{
    isOpen: boolean
    action: "revert" | "restore"
    policyName: string
    currentStep: number
    error: string | null
    isComplete: boolean
    isSuccess: boolean
    newPolicyId?: string
    policyType?: string
  }>({
    isOpen: false,
    action: "revert",
    policyName: "",
    currentStep: 0,
    error: null,
    isComplete: false,
    isSuccess: false
  })

  useEffect(() => {
    if (selectedTenant) {
      void detectDrifts()
    } else {
      setDrifts([])
      setLastScan(null)
      setIsLoading(false)
      setError("")
    }
    return () => scanRequest.current?.abort()
  }, [selectedTenant?.id, selectedTenant?.credentials, selectedTenant?.resources?.storageAccountName])

  const detectDrifts = async () => {
    scanRequest.current?.abort()
    const controller = new AbortController()
    scanRequest.current = controller
    setConfirmDialog(null)
    setDrifts([])
    setLastScan(null)
    
    if (!selectedTenant?.credentials || !selectedTenant?.resources?.storageAccountName) {
      console.error("Missing tenant credentials or storage account", {
        hasCredentials: !!selectedTenant?.credentials,
        hasResources: !!selectedTenant?.resources,
        storageAccountName: selectedTenant?.resources?.storageAccountName
      })
      setIsLoading(false)
      setError("Connect this tenant and choose its backup storage in Settings before comparing drift.")
      return
    }
    
    setIsLoading(true)
    setError("")
    setLoadingProgress(0)
    setLoadingMessage("Fetching backup metadata...")
    
    // Simulate progress updates
    const progressInterval = setInterval(() => {
      setLoadingProgress(prev => {
        if (prev >= 90) return prev
        return prev + Math.random() * 15
      })
    }, 500)
    
    const messageTimeout1 = setTimeout(() => {
      setLoadingMessage("Analyzing policy configurations...")
    }, 1500)
    
    const messageTimeout2 = setTimeout(() => {
      setLoadingMessage("Comparing changes across backups...")
    }, 3000)
    
    const messageTimeout3 = setTimeout(() => {
      setLoadingMessage("Detecting configuration drifts...")
    }, 4500)
    
    try {
      console.log("Calling detect-drifts API with:", {
        tenantId: selectedTenant.credentials.tenantId,
        storageAccountName: selectedTenant.resources.storageAccountName
      })
      const response = await fetch("/api/detect-drifts", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...selectedTenant.credentials,
          storageAccountName: selectedTenant.resources.storageAccountName,
          backupLimit: 5  // Compare the last 5 backups to maintain history
        }),
      })

      console.log("API response status:", response.status)

      if (!response.ok) {
        const errorData = await response.json()
        console.error("API error response:", errorData)
        throw new Error(errorData.error || "Failed to detect drifts")
      }

      const data = await response.json()
      if (controller.signal.aborted) return
      
      // Add tenant information to each drift
      let driftsWithTenant = data.drifts.map((drift: Drift) => ({
        ...drift,
        tenant: selectedTenant.name,
        tenantId: selectedTenant.id.toString()
      }))
      
      // If there are too many "added" drifts (>50), it's likely a baseline issue
      // Show a warning and filter them out
      const addedDrifts = driftsWithTenant.filter((d: Drift) => d.changeType === "added")
      if (addedDrifts.length > 50) {
        console.warn(`Found ${addedDrifts.length} new policies - this might be a baseline issue`)
        // Optionally filter out added drifts to reduce noise
        // driftsWithTenant = driftsWithTenant.filter((d: Drift) => d.changeType !== "added")
      }
      
      setDrifts(driftsWithTenant)
      setSummary(data.summary)
      setLastScan(data.lastScan)
      setBackupsAnalyzed(data.backupsAnalyzed || 0)
      
      // Complete the progress
      setLoadingProgress(100)
      setLoadingMessage("Analysis complete!")
      
      // Small delay to show completion
      setTimeout(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      }, 500)
    } catch (err) {
      if (controller.signal.aborted) return
      console.error("Error detecting drifts:", err)
      setError(err instanceof Error ? err.message : "Failed to detect drifts")
      setIsLoading(false)
    } finally {
      // Clean up intervals and timeouts
      clearInterval(progressInterval)
      clearTimeout(messageTimeout1)
      clearTimeout(messageTimeout2)
      clearTimeout(messageTimeout3)
    }
  }

  const filteredDrifts = drifts

  // Generate drift trends from actual data
  const generateDriftTrends = () => {
    const trends = []
    const now = new Date()
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      
      // Count drifts for this day
      const dayDrifts = drifts.filter(drift => {
        const driftDate = new Date(drift.toBackupTimestamp ?? drift.detectedAt)
        return driftDate.toDateString() === date.toDateString()
      })
      
      trends.push({
        date: dateStr,
        added: dayDrifts.filter(d => d.changeType === "added").length,
        modified: dayDrifts.filter(d => d.changeType === "modified").length
      })
    }
    
    return trends
  }

  const driftTrends = generateDriftTrends()

  // Puts the policy back to the backed-up version in place, or recreates a deleted policy under its original name.
  const handleRevertAction = (drift: Drift) => {
    setConfirmDialog({
      isOpen: true,
      driftId: drift.id,
      action: "revert",
      title: drift.changeType === "deleted" ? "Recreate Deleted Policy" : "Revert to Previous Version",
      message: drift.changeType === "deleted"
        ? `Recreate "${drift.configName}" from the backup under its original name? Assignments are not restored.`
        : `Put "${drift.configName}" back to the backed-up version? The current settings are overwritten and reach devices at their next check-in. Assignments stay as they are.`
    })
  }

  const handleRestoreAction = (drift: Drift) => {
    setConfirmDialog({
      isOpen: true,
      driftId: drift.id,
      action: "restore",
      title: drift.changeType === "deleted" ? "Restore Deleted Policy" : "Restore Previous Version",
      message: drift.changeType === "deleted" 
        ? `Are you sure you want to restore "${drift.configName}"? This will create a new policy with the prefix "[Restored]".`
        : `Are you sure you want to restore the previous version of "${drift.configName}"? This will create a new policy with the prefix "[Restored]" without modifying the current policy.`
    })
  }

  const executeRevert = async () => {
    if (!confirmDialog || !selectedTenant?.credentials || !selectedTenant?.resources?.storageAccountName) return
    
    const drift = drifts.find(d => d.id === confirmDialog.driftId)
    if (!drift) return
    
    setRevertingDriftId(drift.id)
    const action = confirmDialog.action
    setConfirmDialog(null)
    
    // Open progress modal
    setProgressModal({
      isOpen: true,
      action,
      policyName: drift.configName,
      currentStep: 0,
      error: null,
      isComplete: false,
      isSuccess: false,
      policyType: drift.type
    })
    
    try {
      // Step 1: Fetching policy from backup
      setProgressModal(prev => ({ ...prev, currentStep: 0 }))
      // drift.fromBackup now contains the actual backup folder name (e.g., "backup-2025-08-08-072123")
      const backupFolderName = drift.fromBackup
      // Drift results name the item's file; older results only had its display name.
      const fullBackupPath = drift.backupFile
        ? `${backupFolderName}/${drift.backupFile}`
        : `${backupFolderName}/${getPolicyTypePath(drift.type)}/${drift.configName}.json`
      
      // Step 2: Preparing policy data
      setProgressModal(prev => ({ ...prev, currentStep: 1 }))
      await new Promise(resolve => setTimeout(resolve, 500)) // Small delay for visual feedback
      
      // Step 3: Applying changes to Intune
      setProgressModal(prev => ({ ...prev, currentStep: 2 }))
      
      const response = await fetch("/api/revert-policy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...selectedTenant.credentials,
          storageAccountName: selectedTenant.resources.storageAccountName,
          action,
          policyId: drift.configId,
          policyType: drift.type,
          backupPath: fullBackupPath,
          originalName: drift.configName,
          fromBackup: drift.fromBackup,
          toBackup: drift.toBackup,
          changes: drift.changes
        }),
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to revert policy")
      }
      
      const result = await response.json()
      
      // Step 4: Updating metadata
      setProgressModal(prev => ({ ...prev, currentStep: 3, newPolicyId: result.policyId }))
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Step 5: Refreshing drift detection
      setProgressModal(prev => ({ ...prev, currentStep: 4, newPolicyId: result.policyId }))
      
      // Clear any existing errors
      setError("")
      
      // Refresh drift detection
      await detectDrifts()
      
      // Show success
      setProgressModal(prev => ({ 
        ...prev, 
        currentStep: 5,
        isComplete: true,
        isSuccess: true 
      }))
      
    } catch (err) {
      console.error("Revert error:", err)
      const errorMessage = err instanceof Error ? err.message : "Failed to revert policy"
      
      // Show error in modal
      setProgressModal(prev => ({ 
        ...prev, 
        error: errorMessage,
        isComplete: true,
        isSuccess: false 
      }))
      
      setError(errorMessage)
    } finally {
      setRevertingDriftId(null)
    }
  }

  const getPolicyTypePath = (type: string): string => {
    switch (type) {
      case "Device Configuration": return "DeviceConfigurations"
      case "Compliance Policy": return "CompliancePolicies"
      case "Configuration Policy": return "ConfigurationPolicies"
      case "App Protection": return "AppProtectionPolicies"
      case "Conditional Access": return "ConditionalAccessPolicies"
      default: return "Unknown"
    }
  }


  const getChangeTypeIcon = (type: string) => {
    switch (type) {
      case "added":
        return <Plus className="h-4 w-4 text-green-500" />
      case "modified":
        return <Edit className="h-4 w-4 text-yellow-500" />
      case "deleted":
        return <X className="h-4 w-4 text-red-500" />
      default:
        return <GitBranch className="h-4 w-4 text-gray-500" />
    }
  }

  const getConfigTypeIcon = (type: string) => {
    switch (type) {
      case "Compliance Policy":
        return <Shield className="h-5 w-5" />
      case "Device Configuration":
        return <Smartphone className="h-5 w-5" />
      case "App Protection":
      case "App Deployment":
        return <Package className="h-5 w-5" />
      case "Conditional Access":
        return <FileText className="h-5 w-5" />
      default:
        return <Settings className="h-5 w-5" />
    }
  }

  const backupTime = (timestamp: string | undefined, folder: string) => timestamp ? new Date(timestamp).toLocaleString() : folder

  const getRelativeTime = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))
    
    if (diffInHours < 1) return "Just now"
    if (diffInHours < 24) return `${diffInHours}h ago`
    return `${Math.floor(diffInHours / 24)}d ago`
  }

  // Calculate drift by type for analysis view
  const getDriftsByType = () => {
    const typeMap = new Map<string, number>()
    
    drifts.forEach(drift => {
      const count = typeMap.get(drift.type) || 0
      typeMap.set(drift.type, count + 1)
    })
    
    return Array.from(typeMap.entries()).map(([type, count]) => ({
      type,
      count,
      percentage: drifts.length > 0 ? (count / drifts.length) * 100 : 0
    }))
  }

  // Export report functionality
  const handleExportReport = (format: 'json' | 'csv') => {
    if (drifts.length === 0) {
      setError("No drift data to export")
      return
    }

    const timestamp = new Date().toISOString()
    const filename = `drift-report-${new Date().toISOString().split('T')[0]}`

    if (format === 'json') {
      exportAsJSON(filename, timestamp)
    } else if (format === 'csv') {
      exportAsCSV(filename)
    }
  }

  const exportAsJSON = (filename: string, timestamp: string) => {
    // Calculate summary statistics
    const changeTypeSummary = {
      added: drifts.filter(d => d.changeType === 'added').length,
      modified: drifts.filter(d => d.changeType === 'modified').length,
      deleted: drifts.filter(d => d.changeType === 'deleted').length
    }

    const exportData = {
      metadata: {
        exportDate: timestamp,
        tenant: selectedTenant?.name || 'Unknown',
        tenantDomain: selectedTenant?.domain || 'Unknown',
        lastScan: lastScan,
        backupsAnalyzed: drifts[0]?.comparisonIndex ?? 0
      },
      summary: {
        ...summary,
        byChangeType: changeTypeSummary,
        byPolicyType: getDriftsByType()
      },
      drifts: drifts.map(drift => ({
        ...drift,
        // Ensure dates are properly formatted
        detectedAt: drift.detectedAt,
        fromBackup: drift.fromBackup,
        toBackup: drift.toBackup,
        // Exclude UI-specific fields
        isRevertDrift: undefined,
        revertTimestamp: undefined
      }))
    }

    // Create and download JSON file
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${filename}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const exportAsCSV = (filename: string) => {
    // CSV Headers
    const headers = [
      'Config Name',
      'Type',
      'Change Type',
      'Severity',
      'Detected At',
      'Impact',
      'Affected Policies',
      'Affected Devices',
      'Description',
      'From Backup',
      'To Backup'
    ]

    // Convert drifts to CSV rows
    const rows = drifts.map(drift => [
      drift.configName,
      drift.type,
      drift.changeType,
      drift.severity,
      new Date(drift.detectedAt).toLocaleString(),
      drift.impact,
      drift.affectedPolicies.toString(),
      drift.affectedDevices.toString(),
      drift.description,
      backupTime(drift.fromBackupTimestamp, drift.fromBackup),
      backupTime(drift.toBackupTimestamp, drift.toBackup)
    ])

    // Create CSV content
    const csvContent = [
      headers.join(','),
      ...rows.map(row => 
        row.map(value => {
          // Escape quotes and wrap in quotes if contains comma, newline, or quotes
          const escaped = String(value).replace(/"/g, '""')
          return /[,\n"]/.test(escaped) ? `"${escaped}"` : escaped
        }).join(',')
      )
    ].join('\n')

    // Create and download CSV file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${filename}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const viewTabClass = (mode: typeof viewMode) => cn(
    "h-9 rounded-full px-4 transition-colors",
    viewMode === mode
      ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
      : "text-gray-500 hover:text-gray-900"
  )

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-4xl font-medium tracking-tight text-gray-900">Drift Detection</h1>
          <p className="mt-2 text-base text-gray-500">Monitor configuration changes and maintain compliance</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="outline" 
                size="lg"
                disabled={drifts.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                Export Report
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExportReport('json')}>
                <FileJson className="h-4 w-4 mr-2" />
                Export as JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportReport('csv')}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Export as CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button 
            size="lg"
            className="bg-coral-600 text-white hover:bg-coral-700"
            onClick={detectDrifts}
            disabled={isLoading || !selectedTenant}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Detecting...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Run Detection Now
              </>
            )}
          </Button>
        </div>
      </div>

      {/* No Tenant Alert */}
      {!selectedTenant && (
        <Alert className="rounded-3xl border-transparent bg-white p-5 [&>svg]:left-5 [&>svg]:top-5">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Please select a tenant to view drift detection data.
          </AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="rounded-3xl bg-white p-12">
          <div className="flex flex-col items-center justify-center max-w-md mx-auto">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
              <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
            </div>
            <h3 className="text-xl font-medium tracking-tight text-gray-900 mb-2">Analyzing Configuration Drifts</h3>
            <p className="text-gray-600 text-center mb-4">{loadingMessage || "Preparing to analyze backups..."}</p>
            
            {/* Progress Bar */}
            <div className="w-full mb-4">
              <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                <span>Progress</span>
                <span>{Math.round(loadingProgress)}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-coral-500 h-2 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${loadingProgress}%` }}
                />
              </div>
            </div>
            
            <div className="text-xs text-gray-500 text-center space-y-1">
              <p>Comparing the last 5 backups to detect changes</p>
              <p>This may take a few moments depending on the number of policies</p>
            </div>
            
            {/* Activity Indicators */}
            <div className="flex items-center gap-4 mt-6">
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <Activity className="h-3 w-3 animate-pulse" />
                <span>Scanning policies</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <GitCompare className="h-3 w-3 animate-pulse" />
                <span>Comparing changes</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Drift results are unavailable. {error}</AlertDescription>
        </Alert>
      )}

      {/* Baseline Warning */}
      {!isLoading && !error && selectedTenant && drifts.filter(d => d.changeType === "added").length > 50 && (
        <Alert className="rounded-3xl border-transparent bg-white p-5 [&>svg]:left-5 [&>svg]:top-5">
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>High number of new policies detected.</strong> This typically happens when comparing against older backups without a proper baseline. 
            The drift detection will be more accurate after your next backup when comparing consecutive backups.
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      {!isLoading && !error && selectedTenant && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-3xl bg-white p-6">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm text-gray-500">Total Drifts</span>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                <GitCompare className="h-4 w-4 text-gray-600" />
              </span>
            </div>
            <p className="text-4xl font-medium tracking-tight text-gray-900">{drifts.length}</p>
            <div className="flex items-center gap-1 mt-2">
              <span className="text-xs text-gray-500">Comparing last 2 backups</span>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm text-gray-500">New Policies</span>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50">
                <Plus className="h-4 w-4 text-green-700" />
              </span>
            </div>
            <p className="text-4xl font-medium tracking-tight text-gray-900">{drifts.filter(d => d.changeType === "added").length}</p>
            <p className="text-xs text-gray-500 mt-2">Recently added</p>
          </div>

          <div className="rounded-3xl bg-white p-6">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm text-gray-500">Modified Policies</span>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50">
                <Edit className="h-4 w-4 text-blue-600" />
              </span>
            </div>
            <p className="text-4xl font-medium tracking-tight text-gray-900">{drifts.filter(d => d.changeType === "modified").length}</p>
            <p className="text-xs text-gray-500 mt-2">Configuration changes</p>
          </div>

          <div className="rounded-3xl bg-white p-6">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm text-gray-500">Last Scan</span>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                <Clock className="h-4 w-4 text-gray-600" />
              </span>
            </div>
            <p className="text-4xl font-medium tracking-tight text-gray-900">
              {lastScan ? getRelativeTime(lastScan) : "Never"}
            </p>
            <Button 
              size="sm" 
              variant="outline" 
              className="mt-3"
              onClick={detectDrifts}
              disabled={isLoading}
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </Button>
          </div>
        </div>
      )}

      {/* Filters and View Toggle */}
      {!isLoading && !error && selectedTenant && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <p className="inline-flex h-9 items-center gap-2 rounded-full border border-gray-200 bg-white px-4 text-sm text-gray-700">
              <span className="h-1.5 w-1.5 rounded-full bg-coral-500" />
              Scope: {selectedTenant.name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-full bg-white p-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode("list")}
                className={viewTabClass("list")}
              >
                <GitBranch className="h-4 w-4 mr-2" />
                List
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode("timeline")}
                className={viewTabClass("timeline")}
              >
                <Activity className="h-4 w-4 mr-2" />
                Timeline
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode("analysis")}
                className={viewTabClass("analysis")}
              >
                <BarChart3 className="h-4 w-4 mr-2" />
                Analysis
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Info about filtered restored policies */}
      {viewMode === "list" && !isLoading && !error && selectedTenant && filteredDrifts.length > 0 && (
        <Alert className="rounded-3xl border-transparent bg-blue-50/50 p-5 [&>svg]:left-5 [&>svg]:top-5">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-900">
            <strong>Note:</strong> Policies that you've restored (those with "[Restored]" prefix) are automatically excluded from drift detection to avoid confusion.
          </AlertDescription>
        </Alert>
      )}

      {/* List View */}
      {viewMode === "list" && !isLoading && !error && selectedTenant && (
        <div className="space-y-3">
          {filteredDrifts.map((drift) => (
            <div
              key={drift.id}
              className={cn(
                "rounded-3xl bg-white border p-6 transition-colors cursor-pointer",
                drift.isRevertDrift && "opacity-60",
                selectedDrift === drift.id 
                  ? "border-blue-200" 
                  : "border-transparent hover:border-gray-200"
              )}
              onClick={() => setSelectedDrift(selectedDrift === drift.id ? null : drift.id)}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start gap-4">
                  <div className={cn(
                    "h-12 w-12 shrink-0 rounded-full flex items-center justify-center",
                    drift.changeType === "added" && "bg-green-50 text-green-700",
                    drift.changeType === "modified" && "bg-blue-50 text-blue-600",
                    drift.changeType === "deleted" && "bg-red-50 text-red-600"
                  )}>
                    {getConfigTypeIcon(drift.type)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-gray-900">{drift.configName}</h3>
                      {getChangeTypeIcon(drift.changeType)}
                      {drift.lastRevertedAt && !drift.isRevertDrift && (
                        <span className="flex items-center gap-1 px-2.5 py-0.5 bg-green-50 text-green-700 text-xs font-medium rounded-full">
                          <Check className="h-3 w-3" />
                          Reverted
                        </span>
                      )}
                      {drift.isRevertDrift && (
                        <span className="flex items-center gap-1 px-2.5 py-0.5 bg-muted text-gray-600 text-xs font-medium rounded-full">
                          <Info className="h-3 w-3" />
                          Result of Revert
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mb-2">{drift.tenant} • {drift.type}</p>
                    <p className="text-sm text-gray-700">{drift.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {getRelativeTime(drift.toBackupTimestamp ?? drift.detectedAt)}
                      </span>
                      <span className="flex items-center gap-1">
                        <GitBranch className="h-3 w-3" />
                        {drift.changeType}
                      </span>
                      {drift.changes && drift.changes.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Edit className="h-3 w-3" />
                          {drift.changes.length} changes
                        </span>
                      )}
                      {drift.lastRevertedAt && (
                        <span className="flex items-center gap-1 text-green-600">
                          <RefreshCw className="h-3 w-3" />
                          Reverted {getRelativeTime(drift.lastRevertedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={cn(
                    "px-3 py-1 text-xs font-medium rounded-full capitalize",
                    drift.changeType === "added" && "bg-green-50 text-green-700",
                    drift.changeType === "modified" && "bg-blue-50 text-blue-700",
                    drift.changeType === "deleted" && "bg-red-50 text-red-700"
                  )}>
                    {drift.changeType}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedDrift(selectedDrift === drift.id ? null : drift.id)
                    }}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    View Diff
                  </Button>
                </div>
              </div>

              {selectedDrift === drift.id && (
                <div className="border-t border-gray-100 pt-5 mt-5 space-y-3">
                  {drift.isRevertDrift && (
                    <div className="bg-gray-50 rounded-2xl p-4">
                      <h4 className="font-medium text-gray-900 mb-1">Revert Drift Information</h4>
                      <p className="text-sm text-gray-700">
                        This change was detected because you reverted the policy on {new Date(drift.revertTimestamp!).toLocaleString()}.
                        This is expected behavior and no action is needed.
                      </p>
                    </div>
                  )}
                  
                  <div className="bg-amber-50 rounded-2xl p-4">
                    <h4 className="font-medium text-amber-900 mb-1">Impact Assessment</h4>
                    <p className="text-sm text-amber-800">{drift.impact}</p>
                  </div>
                  
                  {drift.changes && drift.changes.length > 0 && (
                    <div className="bg-gray-50 rounded-2xl p-4">
                      <h4 className="font-medium text-gray-900 mb-3">Configuration Changes</h4>
                      <div className="space-y-3">
                        {drift.changes.map((change, idx) => {
                          // Format the field name for better display
                          let fieldDisplay = change.field
                          let settingName = ''
                          
                          // Handle omaSettings changes
                          if (change.field.includes('omaSettings[')) {
                            const match = change.field.match(/omaSettings\[([^\]]+)\]\.(.+)/)
                            if (match) {
                              settingName = match[1] || ''
                              const property = match[2] || ''
                              if (property === 'value') {
                                fieldDisplay = settingName
                              } else {
                                fieldDisplay = `${settingName}.${property}`
                              }
                            }
                          } else if (change.field === 'version') {
                            fieldDisplay = 'Policy Version'
                          }
                          
                          // Format values for display
                          const formatValue = (value: any) => {
                            if (value === null) return 'null'
                            if (value === undefined) return '(not set)'
                            if (typeof value === 'boolean') return value ? 'true' : 'false'
                            if (typeof value === 'number') return value.toString()
                            if (typeof value === 'string') return value
                            return JSON.stringify(value)
                          }
                          
                          return (
                            <div key={idx} className="border-l-2 border-gray-300 pl-3">
                              <div className="font-medium text-gray-700 text-sm mb-1">
                                {fieldDisplay}
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-red-600 font-mono text-xs">-</span>
                                  <span className="bg-red-50 px-2 py-0.5 rounded-md text-xs font-mono text-red-800">
                                    {formatValue(change.oldValue)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-green-600 font-mono text-xs">+</span>
                                  <span className="bg-green-50 px-2 py-0.5 rounded-md text-xs font-mono text-green-800">
                                    {formatValue(change.newValue)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  
                  <div className="bg-blue-50 rounded-2xl px-4 py-3">
                    <p className="text-xs text-blue-700">
                      <span className="font-medium">Detected between:</span> {backupTime(drift.fromBackupTimestamp, drift.fromBackup)} → {backupTime(drift.toBackupTimestamp, drift.toBackup)}
                      {drift.comparisonIndex !== undefined && drift.comparisonIndex > 0 && (
                        <span className="ml-2 text-blue-600">({drift.comparisonIndex + 1} backup{drift.comparisonIndex > 0 ? 's' : ''} ago)</span>
                      )}
                    </p>
                  </div>
                  
                  {drift.revertHistory && drift.revertHistory.length > 0 && (
                    <div className="bg-green-50 rounded-2xl px-4 py-3">
                      <h4 className="font-medium text-green-900 text-sm mb-2">Revert History</h4>
                      <div className="space-y-1">
                        {drift.revertHistory.map((revert, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs text-green-700">
                            <span className="flex items-center gap-2">
                              <RefreshCw className="h-3 w-3" />
                              {revert.action === "revert" ? "Reverted" : "Restored as new policy"}
                            </span>
                            <span>{new Date(revert.timestamp).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {!drift.lastRevertedAt && !drift.isRevertDrift && (drift.changeType === "deleted" || drift.changeType === "modified") && (
                    <div className="flex flex-wrap items-center gap-2">
                    <GatedButton
                      feature="driftRevert"
                      plan={plan}
                      size="sm"
                      variant="outline"
                      onClick={() => handleRevertAction(drift)}
                      disabled={revertingDriftId === drift.id}
                    >
                      <RefreshCw className="h-4 w-4 mr-1" />
                      {drift.changeType === "deleted" ? "Recreate" : "Revert"}
                    </GatedButton>
                    <Button 
                      size="sm" 
                      className="bg-coral-600 text-white hover:bg-coral-700"
                      onClick={() => handleRestoreAction(drift)}
                      disabled={revertingDriftId === drift.id}
                    >
                      {revertingDriftId === drift.id ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4 mr-1" />
                      )}
                      {drift.changeType === "deleted" ? "Restore as copy" : "Restore previous version as copy"}
                    </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Timeline View */}
      {viewMode === "timeline" && !isLoading && !error && selectedTenant && (
        <div className="rounded-3xl bg-white p-6 sm:p-8">
          <h2 className="text-xl font-medium tracking-tight text-gray-900 mb-6">Drift Timeline</h2>
          <div className="relative">
            <div className="absolute left-6 top-0 bottom-0 w-px bg-gray-200" />
            {filteredDrifts.map((drift) => (
              <div key={drift.id} className="relative flex items-start gap-4 mb-6 last:mb-0">
                <div className={cn(
                  "w-12 h-12 shrink-0 rounded-full flex items-center justify-center z-10",
                  drift.changeType === "added" && "bg-green-50 text-green-700",
                  drift.changeType === "modified" && "bg-blue-50 text-blue-600",
                  drift.changeType === "deleted" && "bg-red-50 text-red-600"
                )}>
                  {getConfigTypeIcon(drift.type)}
                </div>
                <div className="flex-1 bg-gray-50 rounded-2xl p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-medium text-gray-900">{drift.configName}</h3>
                      <p className="text-sm text-gray-600">{drift.tenant}</p>
                    </div>
                    <span className="text-xs text-gray-500">{getRelativeTime(drift.toBackupTimestamp ?? drift.detectedAt)}</span>
                  </div>
                  <p className="text-sm text-gray-700 mb-2">{drift.description}</p>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      {getChangeTypeIcon(drift.changeType)}
                      {drift.changeType}
                    </span>
                    {drift.changes && drift.changes.length > 0 && (
                      <span>{drift.changes.length} field{drift.changes.length > 1 ? 's' : ''} changed</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Analysis View */}
      {viewMode === "analysis" && !isLoading && !error && selectedTenant && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-3xl bg-white p-6 sm:p-8">
            <h2 className="text-xl font-medium tracking-tight text-gray-900 mb-4">Drift Trends (7 Days)</h2>
            <div className="h-64 flex items-end justify-between gap-2">
              {driftTrends.map((day) => (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col justify-end" style={{ height: "200px" }}>
                    <div
                      className="w-full bg-green-500 rounded-t"
                      style={{ height: `${(day.added / 10) * 100}%` }}
                    />
                    <div
                      className="w-full bg-coral-500 rounded-b"
                      style={{ height: `${(day.modified / 10) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500">{day.date}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-center gap-4 mt-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded-full" />
                <span className="text-xs text-gray-600">Added</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-coral-500 rounded-full" />
                <span className="text-xs text-gray-600">Modified</span>
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6 sm:p-8">
            <h2 className="text-xl font-medium tracking-tight text-gray-900 mb-4">Drift by Configuration Type</h2>
            <div className="space-y-4">
              {getDriftsByType().map(({ type, count, percentage }) => (
                <div key={type}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">{type}</span>
                    <span className="text-sm text-gray-900">{count} drift{count !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div 
                      className="bg-coral-500 h-2 rounded-full" 
                      style={{ width: `${percentage}%` }} 
                    />
                  </div>
                </div>
              ))}
              {drifts.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">No drifts detected</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={!!confirmDialog} onOpenChange={(open) => { if (!open) setConfirmDialog(null) }}>
        {confirmDialog && (
          <DialogContent className="max-w-md p-8">
            {/* Icon */}
            <div className="flex justify-center mb-6">
              <div className={cn(
                "h-16 w-16 rounded-full flex items-center justify-center",
                confirmDialog.action === "revert" 
                  ? "bg-red-50 text-red-600" 
                  : "bg-blue-50 text-blue-600"
              )}>
                {confirmDialog.action === "revert" ? (
                  <RefreshCw className="h-8 w-8" />
                ) : (
                  <Plus className="h-8 w-8" />
                )}
              </div>
            </div>
            
            {/* Content */}
            <div className="text-center mb-8">
              <DialogTitle className="text-2xl font-medium tracking-tight text-gray-900 mb-3">{confirmDialog.title}</DialogTitle>
              <DialogDescription className="text-gray-600 leading-relaxed">{confirmDialog.message}</DialogDescription>
            </div>
            
            {/* Policy Info */}
            <div className="bg-gray-50 rounded-2xl p-4 mb-6">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-gray-400" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">Policy Name</p>
                  <p className="text-sm text-gray-600">{drifts.find(d => d.id === confirmDialog.driftId)?.configName}</p>
                </div>
              </div>
            </div>
            
            {/* Actions */}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmDialog(null)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 text-white font-medium bg-coral-600 hover:bg-coral-700"
                onClick={executeRevert}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Restored Policy
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
      
      {/* Revert Progress Modal */}
      <RevertProgressModal
        isOpen={progressModal.isOpen}
        onClose={() => setProgressModal(prev => ({ ...prev, isOpen: false }))}
        action={progressModal.action}
        policyName={progressModal.policyName}
        currentStep={progressModal.currentStep}
        error={progressModal.error}
        isComplete={progressModal.isComplete}
        isSuccess={progressModal.isSuccess}
        newPolicyId={progressModal.newPolicyId}
        policyType={progressModal.policyType}
        onComplete={(success) => {
          setProgressModal(prev => ({ ...prev, isOpen: false }))
          // Reset the progress modal state
          setTimeout(() => {
            setProgressModal({
              isOpen: false,
              action: "revert",
              policyName: "",
              currentStep: 0,
              error: null,
              isComplete: false,
              isSuccess: false
            })
          }, 300)
        }}
      />
    </div>
  )
}