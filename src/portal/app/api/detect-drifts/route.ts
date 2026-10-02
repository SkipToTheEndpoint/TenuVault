import { decodeXml, listBlobPages } from "~/lib/storage/list"
import { typeForFolder } from "../../../../shared/intune/registry"
import { withoutUnreadAssignments } from "../../../../shared/intune/read"
import { coveredFolders, type ScopeMetadata } from "../../../../shared/intune/scope"
import { type NextRequest, NextResponse } from "next/server"

interface PolicyFile {
  name: string
  url: string
  lastModified: string
  size: number
}

interface PolicyContent {
  id: string
  displayName: string
  lastModifiedDateTime?: string
  createdDateTime?: string
  [key: string]: any
}

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
  comparisonIndex?: number  // Which backup comparison (0 = most recent)
  revertHistory?: Array<{  // Revert history for this policy
    timestamp: string
    action: "revert" | "restore"
  }>
  lastRevertedAt?: string  // Timestamp of last revert
  isRevertDrift?: boolean  // True if this drift is the result of a revert action
  revertTimestamp?: string // When the revert that caused this drift happened
  /** The item's path inside a backup folder, such as DeviceConfigurations/Name.json. */
  backupFile?: string
  changes?: {
    field: string
    oldValue: any
    newValue: any
  }[]
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      tenantId, 
      appId, 
      clientSecret,
      storageAccountName,
      backupLimit = 10
    } = body

    if (!tenantId || !appId || !clientSecret || !storageAccountName) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      )
    }

    // Get access token for Azure Storage
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: appId,
          client_secret: clientSecret,
          scope: "https://storage.azure.com/.default",
          grant_type: "client_credentials",
        }),
      }
    )

    if (!tokenResponse.ok) {
      return NextResponse.json(
        { error: "Failed to authenticate with Azure" },
        { status: 401 }
      )
    }

    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.access_token

    // List backups (limited to recent ones)
    // Using delimiter=/ to get folder prefixes instead of all blobs
    const listUrl = `https://${storageAccountName}.blob.core.windows.net/intune-backups?restype=container&comp=list&delimiter=/`
    
    const listText = await listBlobPages(listUrl, accessToken)

    console.log("Raw Azure response (first 1000 chars):", listText.substring(0, 1000))
    
    // Parse backup folders and sort by date
    const backupFolders = parseBackupFolders(listText)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, backupLimit)

    console.log("Parsed backup folders:", backupFolders)

    // Compare the two newest complete backups. Incomplete snapshots are missing policies and
    // would report them as deleted, and a running backup has no metadata yet, so both are skipped.
    const completeBackups: Array<(typeof backupFolders)[number] & { metadata: ScopeMetadata }> = []
    for (const backup of backupFolders.length < 2 ? [] : backupFolders) {
      const response = await fetch(`https://${storageAccountName}.blob.core.windows.net/intune-backups/${encodeURIComponent(backup.name)}/metadata.json`, { headers: { 'x-ms-version': '2021-12-02', Authorization: `Bearer ${accessToken}` } })
      if (response.status === 404) continue
      if (!response.ok) throw new Error(`Cannot verify that the backups are complete (${response.status}). Check storage access and retry.`)
      const metadata = await response.json()
      if (['success', 'completed'].includes(String(metadata.Status ?? metadata.status).toLowerCase())) completeBackups.push({ ...backup, metadata })
      if (completeBackups.length === 2) break
    }

    if (completeBackups.length < 2) {
      return NextResponse.json({ error: `Drift comparison needs two complete backups, and the latest ${backupFolders.length} include fewer than two. Incomplete backups are skipped. Create a successful backup and try again.`, code: 'INSUFFICIENT_BACKUPS' }, { status: 409 })
    }

    const newerBackup = completeBackups[0]!
    const olderBackup = completeBackups[1]!

    // Only types both backups hold are compared: a backup that left apps out has not seen them deleted.
    const olderFolders = coveredFolders(olderBackup.metadata)
    const shared = [...coveredFolders(newerBackup.metadata)].filter(folder => olderFolders.has(folder))
    const [newerPolicies, olderPolicies] = await Promise.all([
      fetchPolicyFiles(storageAccountName, newerBackup.name, accessToken, shared),
      fetchPolicyFiles(storageAccountName, olderBackup.name, accessToken, shared)
    ])
    
    // Detect changes between the two most recent backups
    const drifts = await detectDrifts(
      newerPolicies,
      olderPolicies,
      newerBackup,
      olderBackup,
      storageAccountName,
      accessToken,
      0  // Pass comparison index
    )
    
    // Fetch revert metadata for all drift policy IDs
    const policyIds = drifts.map(d => d.configId).filter(id => id)
    if (policyIds.length > 0) {
      try {
        const metadataResponse = await fetch(
          `${request.nextUrl.origin}/api/revert-metadata`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              tenantId,
              appId,
              clientSecret,
              storageAccountName,
              policyIds
            }),
          }
        )
        
        if (metadataResponse.ok) {
          const metadataData = await metadataResponse.json()
          
          // Add revert history to drifts and check for revert drifts
          drifts.forEach(drift => {
            const revertHistory = metadataData.reverts?.[drift.configId]
            if (revertHistory && revertHistory.length > 0) {
              // Filter to only successful reverts
              const successfulReverts = revertHistory
                .filter((r: any) => r.status === "success" && r.action === "revert")
              
              if (successfulReverts.length > 0) {
                // Add revert history
                drift.revertHistory = successfulReverts.map((r: any) => ({
                  timestamp: r.timestamp,
                  action: r.action
                }))
                drift.lastRevertedAt = successfulReverts[successfulReverts.length - 1].timestamp
                
                // Check if this drift is the result of a recent revert
                const recentReverts = successfulReverts.filter((r: any) => {
                  const revertTime = new Date(r.timestamp).getTime()
                  const fromBackupTime = new Date(drift.fromBackupTimestamp ?? "").getTime()
                  const toBackupTime = new Date(drift.toBackupTimestamp ?? "").getTime()
                  
                  // Revert happened between the two backups being compared
                  return revertTime > fromBackupTime && revertTime < toBackupTime
                })
                
                if (recentReverts.length > 0 && drift.changeType === "modified") {
                  const mostRecentRevert = recentReverts[recentReverts.length - 1]
                  
                  // Check if the changes match a revert
                  if (mostRecentRevert.changesReverted && checkIfRevertDrift(drift.changes, mostRecentRevert.changesReverted)) {
                    drift.isRevertDrift = true
                    drift.revertTimestamp = mostRecentRevert.timestamp
                  }
                }
              }
            }
          })
        }
      } catch (error) {
        console.error("Failed to fetch revert metadata:", error)
        // Continue without metadata - don't fail the whole operation
      }
    }

    // Calculate summary
    const summary = {
      total: drifts.length,
      critical: drifts.filter(d => d.severity === "critical").length,
      warning: drifts.filter(d => d.severity === "warning").length,
      info: drifts.filter(d => d.severity === "info").length,
      affectedTenants: 1 // Since we're checking one tenant
    }

    return NextResponse.json({
      drifts,
      summary,
      lastScan: new Date().toISOString(),
      backupsAnalyzed: backupFolders.length
    })
  } catch (error) {
    console.error("Detect drifts error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error while detecting drifts" },
      { status: 500 }
    )
  }
}

export function parseBackupFolders(xmlText: string): { name: string; timestamp: string }[] {
  const folders: { name: string; timestamp: string }[] = []
  const blobPrefixes = xmlText.match(/<BlobPrefix>[\s\S]*?<\/BlobPrefix>/g) || []
  
  for (const prefix of blobPrefixes) {
    const nameMatch = prefix.match(/<Name>([^<]+)<\/Name>/)
    if (nameMatch?.[1]) {
      const name = nameMatch[1].replace(/\/$/, '')
      
      // Try different parsing formats
      // Format 1: backup-2024-08-01-020200 (from list-backups API)
      // Format 2: 2024-08-01_02-02-00_1234567890123
      // Format 3: 2024-08-01_02-02-00
      
      // Check for backup- prefix format
      if (name.startsWith('backup-')) {
        const dateMatch = /backup-(\d{4}-\d{2}-\d{2})-(\d{6})/.exec(name)
        if (dateMatch) {
          const [, dateStr, timeStr] = dateMatch
          const formattedTime = timeStr!.replace(/(\d{2})(\d{2})(\d{2})/, '$1:$2:$3')
          try {
            const timestamp = new Date(`${dateStr}T${formattedTime}Z`).toISOString()
            folders.push({ name, timestamp })
            console.log("Parsed backup folder (backup- format):", { name, timestamp })
          } catch (e) {
            console.error("Failed to parse date for folder:", name, e)
          }
        }
      } else {
        // Try underscore format
        const parts = name.split('_')
        if (parts.length >= 2) {
          const dateStr = parts[0]
          const timeStr = parts[1]?.replace(/-/g, ':')
          if (dateStr && timeStr) {
            try {
              const timestamp = new Date(`${dateStr}T${timeStr}Z`).toISOString()
              folders.push({ name, timestamp })
              console.log("Parsed backup folder (underscore format):", { name, timestamp })
            } catch (e) {
              console.error("Failed to parse date for folder:", name, e)
            }
          }
        }
      }
    }
  }
  
  console.log("Total folders parsed:", folders.length)
  return folders
}

async function fetchPolicyFiles(
  storageAccountName: string,
  backupFolder: string,
  accessToken: string,
  folders: string[]
): Promise<PolicyFile[]> {
  const policies: PolicyFile[] = []
  
  // The compared types, plus the folder older backups used for compliance policies.
  const policyTypes = folders.includes('CompliancePolicies') ? [...folders, 'DeviceCompliancePolicies'] : folders
  
  for (const policyType of policyTypes) {
    const listUrl = `https://${storageAccountName}.blob.core.windows.net/intune-backups?restype=container&comp=list&prefix=${encodeURIComponent(`${backupFolder}/${policyType}/`)}`
    
    {
      const text = await listBlobPages(listUrl, accessToken)
      const blobs = text.match(/<Blob>[\s\S]*?<\/Blob>/g) || []
      
      for (const blob of blobs) {
        const nameMatch = blob.match(/<Name>([^<]+)<\/Name>/)
        const lastModifiedMatch = blob.match(/<Last-Modified>([^<]+)<\/Last-Modified>/)
        const sizeMatch = blob.match(/<Content-Length>([^<]+)<\/Content-Length>/)
        
        if (nameMatch?.[1] && nameMatch[1].endsWith('.json')) {
          policies.push({
            name: decodeXml(nameMatch[1]),
            url: `https://${storageAccountName}.blob.core.windows.net/intune-backups/${decodeXml(nameMatch[1]).split("/").map(encodeURIComponent).join("/")}`,
            lastModified: lastModifiedMatch?.[1] || '',
            size: parseInt(sizeMatch?.[1] || '0')
          })
        }
      }
    }
  }
  
  return policies
}

async function detectDrifts(
  newerPolicies: PolicyFile[],
  olderPolicies: PolicyFile[],
  newerBackup: { name: string; timestamp: string },
  olderBackup: { name: string; timestamp: string },
  storageAccountName: string,
  accessToken: string,
  comparisonIndex: number = 0
): Promise<Drift[]> {
  const drifts: Drift[] = []
  let driftIdCounter = Date.now()
  
  console.log(`Comparing ${newerBackup.name} (newer) with ${olderBackup.name} (older)`)
  console.log(`Newer backup has ${newerPolicies.length} policies`)
  console.log(`Older backup has ${olderPolicies.length} policies`)
  
  // Create maps for easier comparison
  // Remove the backup folder prefix to compare just the policy path
  const newerMap = new Map(newerPolicies.map(p => {
    const relativePath = p.name.substring(p.name.indexOf('/') + 1) // Remove backup-YYYY-MM-DD-HHMMSS/ prefix
    return [relativePath, p]
  }))
  const olderMap = new Map(olderPolicies.map(p => {
    const relativePath = p.name.substring(p.name.indexOf('/') + 1) // Remove backup-YYYY-MM-DD-HHMMSS/ prefix
    return [relativePath, p]
  }))
  
  // Check for added and modified policies
  for (const [name, newerPolicy] of newerMap) {
    const olderPolicy = olderMap.get(name)
    
    if (!olderPolicy) {
      // Policy was added
      const policyContent = await fetchPolicyContent(newerPolicy.url, accessToken)
      const policyType = getPolicyType(name)
      
      // Skip policies that were restored by the user (those with [Restored] prefix)
      if ([policyContent?.displayName, policyContent?.name].some(name => typeof name === 'string' && name.startsWith('[Restored]'))) {
        console.log('Skipping restored policy from drift detection:', policyContent.displayName ?? policyContent.name)
        continue
      }
      
      drifts.push({
        id: `drift-${driftIdCounter++}`,
        tenant: "Current Tenant", // This would come from tenant context
        tenantId: "current-tenant",
        severity: determineSeverity(policyType, "added", policyContent),
        type: policyType,
        configName: policyContent?.displayName || policyContent?.name || name.split('/').pop()?.replace('.json', '') || 'Unknown',
        backupFile: name,
        configId: policyContent?.id || '',
        changeType: "added",
        detectedAt: new Date().toISOString(),
        fromBackup: olderBackup.name, // Use actual folder name instead of timestamp
        toBackup: newerBackup.name, // Use actual folder name instead of timestamp
        fromBackupTimestamp: olderBackup.timestamp, // Keep timestamp for display
        toBackupTimestamp: newerBackup.timestamp, // Keep timestamp for display
        description: `New ${policyType} policy added`,
        impact: determineImpact(policyType, "added", policyContent),
        affectedPolicies: 1,
        affectedDevices: 0, // Would need to fetch assignment data
        comparisonIndex
      })
    } else {
      // Policy exists in both backups - check if content changed
      const [newerContent, olderContent] = await Promise.all([
        fetchPolicyContent(newerPolicy.url, accessToken),
        fetchPolicyContent(olderPolicy.url, accessToken)
      ])
      
      const changes = compareObjects(...withoutUnreadAssignments(typeOfFile(name), olderContent, newerContent))
      
      if (changes.length > 0) {
        const policyType = getPolicyType(name)
        
        drifts.push({
          id: `drift-${driftIdCounter++}`,
          tenant: "Current Tenant",
          tenantId: "current-tenant",
          severity: determineSeverity(policyType, "modified", newerContent, changes),
          type: policyType,
          configName: newerContent?.displayName || newerContent?.name || name.split('/').pop()?.replace('.json', '') || 'Unknown',
          backupFile: name,
          configId: newerContent?.id || '',
          changeType: "modified",
          detectedAt: new Date().toISOString(),
          fromBackup: olderBackup.name, // Use actual folder name instead of timestamp
          toBackup: newerBackup.name, // Use actual folder name instead of timestamp
          fromBackupTimestamp: olderBackup.timestamp, // Keep timestamp for display
          toBackupTimestamp: newerBackup.timestamp, // Keep timestamp for display
          description: generateChangeDescription(policyType, changes),
          impact: determineImpact(policyType, "modified", newerContent, changes),
          affectedPolicies: 1,
          affectedDevices: 0,
          changes,
          comparisonIndex
        })
      }
    }
  }
  
  // Check for deleted policies
  for (const [name, olderPolicy] of olderMap) {
    if (!newerMap.has(name)) {
      const policyContent = await fetchPolicyContent(olderPolicy.url, accessToken)
      const policyType = getPolicyType(name)
      
      drifts.push({
        id: `drift-${driftIdCounter++}`,
        tenant: "Current Tenant",
        tenantId: "current-tenant",
        severity: determineSeverity(policyType, "deleted", policyContent),
        type: policyType,
        configName: policyContent?.displayName || policyContent?.name || name.split('/').pop()?.replace('.json', '') || 'Unknown',
        backupFile: name,
        configId: policyContent?.id || '',
        changeType: "deleted",
        detectedAt: new Date().toISOString(),
        fromBackup: olderBackup.name, // Use actual folder name instead of timestamp
        toBackup: newerBackup.name, // Use actual folder name instead of timestamp
        fromBackupTimestamp: olderBackup.timestamp, // Keep timestamp for display
        toBackupTimestamp: newerBackup.timestamp, // Keep timestamp for display
        description: `${policyType} policy deleted`,
        impact: determineImpact(policyType, "deleted", policyContent),
        affectedPolicies: 1,
        affectedDevices: 0,
        comparisonIndex
      })
    }
  }
  
  return drifts
}

async function fetchPolicyContent(url: string, accessToken: string): Promise<PolicyContent> {
  const response = await fetch(url, { headers: { 'x-ms-version': '2021-12-02', Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw new Error(`A backed-up policy could not be read (${response.status}). Drift results are unavailable.`)
  return await response.json()
}

/** The drift page maps these three labels back to their backup folders. */
const LEGACY_LABELS: Record<string, string> = {
  DeviceConfigurations: 'Device Configuration',
  CompliancePolicies: 'Compliance Policy',
  DeviceCompliancePolicies: 'Compliance Policy',
  ConfigurationPolicies: 'Configuration Policy',
}

/** The type folder holds the file, with or without the backup folder in front of it. */
function folderOf(fileName: string): string {
  const parts = fileName.split('/')
  return parts[parts.length - 2] ?? ''
}

function typeOfFile(fileName: string) {
  const folder = folderOf(fileName)
  return typeForFolder(folder === 'DeviceCompliancePolicies' ? 'CompliancePolicies' : folder)
}

function getPolicyType(fileName: string): string {
  const folder = folderOf(fileName)
  const label = LEGACY_LABELS[folder] ?? typeForFolder(folder)?.label
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : 'Unknown Policy'
}

/** Stable identity for each array item, or null when the items cannot be matched reliably. */
function arrayItemKeys(items: any[], path: string): string[] | null {
  const keys = items.map((item): string | undefined => {
    if (item === null || typeof item !== 'object') return JSON.stringify(item)
    if (path.endsWith('omaSettings')) return item.displayName || item.omaUri
    return item.settingInstance?.settingDefinitionId ?? item.settingDefinitionId
  })
  if (keys.some(key => typeof key !== 'string') || new Set(keys).size !== keys.length) return null
  return keys as string[]
}

export function compareObjects(
  oldObj: any,
  newObj: any,
  path: string = '',
  context: any = { parent: null, arrayIndex: null }
): { field: string; oldValue: any; newValue: any; displayName?: string }[] {
  const changes: { field: string; oldValue: any; newValue: any; displayName?: string }[] = []

  if (oldObj === null || newObj === null || typeof oldObj !== 'object' || typeof newObj !== 'object') {
    return JSON.stringify(oldObj) === JSON.stringify(newObj) ? [] : [{ field: path, oldValue: oldObj, newValue: newObj }]
  }

  // Skip metadata fields and fields that should not be considered as drifts
  const skipFields = [
    '@odata.context', 
    '@odata.type', 
    'lastModifiedDateTime', 
    'createdDateTime',
    'id',  // ID changes when policy is recreated
    'version',  // Version auto-increments
    'description',  // Description contains our revert notices
    'settings@odata.context',  // Contains policy ID in URL
    'secretReferenceValueId'  // Regenerated by Intune on every write of an encrypted OMA-URI value
  ]
  
  if (Array.isArray(oldObj) && Array.isArray(newObj)) {
    // Match items by a stable key when every item has a unique one, so an added, removed or
    // reordered setting is reported as itself instead of shifting every later index.
    const oldKeys = arrayItemKeys(oldObj, path)
    const newKeys = arrayItemKeys(newObj, path)
    if (oldKeys && newKeys) {
      const newMap = new Map(newKeys.map((key, i) => [key, newObj[i]]))
      const oldSet = new Set(oldKeys)
      oldKeys.forEach((key, i) => {
        const itemPath = `${path}[${key}]`
        if (newMap.has(key)) changes.push(...compareObjects(oldObj[i], newMap.get(key), itemPath, { parent: oldObj[i], arrayIndex: key }))
        else changes.push({ field: itemPath, oldValue: oldObj[i], newValue: undefined })
      })
      newKeys.forEach((key, i) => {
        if (!oldSet.has(key)) changes.push({ field: `${path}[${key}]`, oldValue: undefined, newValue: newObj[i] })
      })
    } else {
      const maxLength = Math.max(oldObj.length, newObj.length)
      for (let i = 0; i < maxLength; i++) {
        if (i < oldObj.length && i < newObj.length) {
          changes.push(...compareObjects(oldObj[i], newObj[i], `${path}[${i}]`, { parent: oldObj[i], arrayIndex: i }))
        } else {
          changes.push({ field: `${path}[${i}]`, oldValue: oldObj[i], newValue: newObj[i] })
        }
      }
    }
    return changes
  }
  
  // Compare all keys in both objects
  const allKeys = new Set([
    ...Object.keys(oldObj || {}),
    ...Object.keys(newObj || {})
  ])
  
  for (const key of allKeys) {
    // Annotations such as assignments@odata.context describe the read, not the configuration.
    if (skipFields.includes(key) || key.endsWith('@odata.context')) continue
    
    const oldValue = oldObj?.[key]
    const newValue = newObj?.[key]
    const currentPath = path ? `${path}.${key}` : key
    
    if (typeof oldValue === 'object' && typeof newValue === 'object' && oldValue !== null && newValue !== null) {
      // Recursively compare objects
      changes.push(...compareObjects(oldValue, newValue, currentPath, { parent: oldObj, arrayIndex: null }))
    } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      const change: any = {
        field: currentPath,
        oldValue,
        newValue
      }
      
      // Add display name for omaSettings values
      if (currentPath.includes('omaSettings') && key === 'value' && context.parent?.displayName) {
        change.displayName = context.parent.displayName
      }
      
      changes.push(change)
    }
  }
  
  return changes
}

function checkIfRevertDrift(
  driftChanges: { field: string; oldValue: any; newValue: any }[] | undefined,
  revertChanges: { field: string; oldValue: any; revertedTo: any }[] | undefined
): boolean {
  if (!driftChanges || !revertChanges) return false
  
  // For each revert change, check if there's a matching drift change
  for (const revertChange of revertChanges) {
    const matchingDrift = driftChanges.find(dc => {
      // Same field
      if (dc.field !== revertChange.field) return false
      
      // The drift's "old value" should match what we reverted from
      // and the drift's "new value" should match what we reverted to
      const oldValueMatches = JSON.stringify(dc.oldValue) === JSON.stringify(revertChange.oldValue)
      const newValueMatches = JSON.stringify(dc.newValue) === JSON.stringify(revertChange.revertedTo)
      
      return oldValueMatches && newValueMatches
    })
    
    if (!matchingDrift) return false
  }
  
  return true
}

function determineSeverity(
  policyType: string,
  changeType: string,
  content: any,
  changes?: { field: string; oldValue: any; newValue: any }[]
): "critical" | "warning" | "info" {
  // Critical changes
  if (changeType === "deleted" && policyType === "Compliance Policy") return "critical"
  if (changeType === "deleted" && policyType === "Conditional Access") return "critical"
  
  // Check for security-related field changes
  if (changes) {
    const criticalFields = ['passwordRequired', 'encryption', 'jailbreak', 'firewall', 'antivirus', 'bitLocker']
    const hasCriticalChange = changes.some(c => 
      criticalFields.some(f => c.field.toLowerCase().includes(f.toLowerCase()))
    )
    if (hasCriticalChange) return "critical"
  }
  
  // Warning level changes
  if (changeType === "deleted") return "warning"
  if (changeType === "modified" && (policyType === "Compliance Policy" || policyType === "Device Configuration")) return "warning"
  
  // Everything else is info
  return "info"
}

function generateChangeDescription(policyType: string, changes: { field: string; oldValue: any; newValue: any; displayName?: string }[]): string {
  if (changes.length === 0) return `${policyType} modified`
  
  // Find the most significant change - look for omaSettings value changes
  const omaValueChange = changes.find(c => c.field.includes('omaSettings') && c.field.includes('.value'))
  const significantChange = omaValueChange || changes.find(c => 
    !c.field.includes('version') && 
    !c.field.includes('modified') &&
    !c.field.includes('description')
  ) || changes[0]
  
  if (!significantChange) return `${policyType} modified`
  
  // Handle omaSettings changes specially
  if (significantChange.field.includes('omaSettings[')) {
    const match = significantChange.field.match(/omaSettings\[([^\]]+)\]\.(.+)/)
    if (match) {
      const [, settingName, property] = match
      if (property === 'value' && settingName) {
        return `${settingName} changed from ${significantChange.oldValue} to ${significantChange.newValue}`
      }
    }
  }
  
  const field = significantChange.field.split('.').pop() || significantChange.field
  
  if (typeof significantChange.oldValue === 'boolean') {
    return `${field} ${significantChange.newValue ? 'enabled' : 'disabled'}`
  }
  
  if (field === 'version') {
    return `Policy version updated`
  }
  
  return `${field} changed from "${significantChange.oldValue}" to "${significantChange.newValue}"`
}

function determineImpact(
  policyType: string,
  changeType: string,
  content: any,
  changes?: { field: string; oldValue: any; newValue: any }[]
): string {
  if (changeType === "deleted") {
    return `${policyType} no longer applied to devices`
  }
  
  if (changeType === "added") {
    return `New ${policyType} will be applied to assigned devices`
  }
  
  if (changes && changes.length > 0) {
    return `${changes.length} configuration ${changes.length === 1 ? 'change' : 'changes'} will affect assigned devices`
  }
  
  return "Configuration updated"
}