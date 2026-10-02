"use client"

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react"

import { useTenants, useTenantOperations } from "./TenantContext"
import { backupCompletionUpdates } from "~/lib/backup-completion"

export interface BackupJob {
  jobId: string
  tenantName: string
  tenantId: string
  status: string
  progress: number
  progressMessage: string
  startTime?: string
  endTime?: string
  exception?: string
  output?: string
  isComplete: boolean
  isSuccessful: boolean
  isMinimized: boolean
  /** Not listed in the floating panel (its workflow shows the progress); still polled so completion is recorded. */
  isHidden?: boolean
  /** Never expands on its own, not even when it is the only job or fails. */
  quiet?: boolean
  credentials: {
    tenantId: string
    appId: string
    clientSecret: string
  }
  resources: {
    subscriptionId: string
    resourceGroupName: string
    automationAccountName: string
  }
}

interface BackupProgressContextType {
  activeJobs: BackupJob[]
  addJob: (job: Omit<BackupJob, "isMinimized">) => void
  updateJob: (jobId: string, updates: Partial<BackupJob>) => void
  removeJob: (jobId: string) => void
  minimizeJob: (jobId: string) => void
  expandJob: (jobId: string) => void
  getJob: (jobId: string) => BackupJob | undefined
}

const BackupProgressContext = createContext<BackupProgressContextType | undefined>(undefined)

export function BackupProgressProvider({ children }: { children: ReactNode }) {
  const [activeJobs, setActiveJobs] = useState<BackupJob[]>([])
  const tenants = useTenants()
  const { updateTenant } = useTenantOperations()
  const recorded = useRef(new Set<string>())

  // This provider stays mounted across navigation, so every tracked job updates
  // its tenant even when the initiating page or progress modal is gone.
  useEffect(() => {
    const current = new Map(tenants.map((tenant) => [tenant.id, { ...tenant }]))
    for (const job of activeJobs) {
      if (!job.isComplete || recorded.current.has(job.jobId)) continue
      const original = tenants.find((item) => item.credentials?.tenantId.toLowerCase() === job.tenantId.toLowerCase())
      if (!original) continue
      const tenant = current.get(original.id)!
      recorded.current.add(job.jobId)
      const updates = backupCompletionUpdates(job, tenant.lastBackup, tenant.lastSync)
      Object.assign(tenant, updates)
      updateTenant(tenant.id, updates)
    }
  }, [activeJobs, tenants, updateTenant])

  // Add a new job to track
  const addJob = useCallback((job: Omit<BackupJob, "isMinimized">) => {
    setActiveJobs(prev => prev.some((existing) => existing.jobId === job.jobId) ? prev : [...prev, { ...job, isMinimized: true }])
  }, [])

  // Update an existing job
  const updateJob = useCallback((jobId: string, updates: Partial<BackupJob>) => {
    setActiveJobs(prev => 
      prev.map(job => 
        job.jobId === jobId ? { ...job, ...updates } : job
      )
    )
  }, [])

  // Remove a job from tracking
  const removeJob = useCallback((jobId: string) => {
    setActiveJobs(prev => prev.filter(job => job.jobId !== jobId))
  }, [])

  // Minimize a job (show in floating notification)
  const minimizeJob = useCallback((jobId: string) => {
    updateJob(jobId, { isMinimized: true })
  }, [updateJob])

  // Expand a job (show details)
  const expandJob = useCallback((jobId: string) => {
    updateJob(jobId, { isMinimized: false })
  }, [updateJob])

  // Get a specific job
  const getJob = useCallback((jobId: string) => {
    return activeJobs.find(job => job.jobId === jobId)
  }, [activeJobs])

  // Poll for job updates
  useEffect(() => {
    const intervals: NodeJS.Timeout[] = []

    activeJobs.forEach(job => {
      if (!job.isComplete) {
        const interval = setInterval(async () => {
          try {
            const response = await fetch("/api/backup/status", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                ...job.credentials,
                ...job.resources,
                jobId: job.jobId
              }),
            })

            if (!response.ok) {
              const errorData = await response.json()
              throw new Error(errorData.error || "Failed to check job status")
            }

            const data = await response.json()
            updateJob(job.jobId, {
              status: data.status,
              progress: data.progress,
              progressMessage: data.progressMessage,
              startTime: data.startTime,
              endTime: data.endTime,
              exception: data.exception,
              output: data.output,
              isComplete: data.isComplete,
              isSuccessful: data.isSuccessful
            })

            // Stop polling if job is complete
            if (data.isComplete) {
              clearInterval(interval)
              
              // Auto-remove successful jobs after 30 seconds
              if (data.isSuccessful) {
                setTimeout(() => {
                  removeJob(job.jobId)
                }, 30000)
              }
            }
          } catch (err) {
            console.error("Error checking job status:", err)
            // Don't remove the job on error, just log it
          }
        }, 2000) // Poll every 2 seconds

        intervals.push(interval)
      }
    })

    // Cleanup intervals
    return () => {
      intervals.forEach(interval => clearInterval(interval))
    }
  }, [activeJobs, updateJob, removeJob])

  return (
    <BackupProgressContext.Provider 
      value={{
        activeJobs,
        addJob,
        updateJob,
        removeJob,
        minimizeJob,
        expandJob,
        getJob
      }}
    >
      {children}
    </BackupProgressContext.Provider>
  )
}

export function useBackupProgress() {
  const context = useContext(BackupProgressContext)
  if (context === undefined) {
    throw new Error("useBackupProgress must be used within a BackupProgressProvider")
  }
  return context
}