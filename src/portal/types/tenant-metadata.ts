export interface TenantMetadata {
  tenantId: string
  organizationId?: string
  customName?: string
  domain: string
  tags: string[]
  environment: string
  license: string
  industry?: string
  
  // Azure Resources
  azureResources?: {
    subscriptionId: string
    resourceGroupName: string
    storageAccountName: string
    automationAccountName: string
    resourceGroupLocation?: string
    containerName?: string
  }
  
  // Preferences
  preferences?: {
    preferredRunbook?: string
    backupSchedule?: string
    retentionDays?: number
    notificationEmail?: string
  }
  
  // Metadata
  metadata: {
    createdAt: string
    lastModified: string
    lastModifiedBy?: string
    notes?: string
  }
}

export interface TenantMetadataCheckResponse {
  exists: boolean
  metadata?: TenantMetadata
}

export interface TenantMetadataSaveRequest {
  tenantId: string
  appId: string
  clientSecret: string
  storageAccountName: string
  metadata: Partial<TenantMetadata>
}

export interface TenantMetadataLoadRequest {
  tenantId: string
  appId: string
  clientSecret: string
  storageAccountName: string
}