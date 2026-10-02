import type { AssessmentScope } from './types'

/** Read-only evidence input, adapted from IntuneDocumentation. No secret recovery or writes. */
export interface DetailedExportData {
  collectedAt?: string
  collectionStartedAt?: string
  collectionSkippedFamilies?: string[]
  assessmentScope?: AssessmentScope
  permissionErrors?: { resource: string; message: string; requiredPermission: string }[]
  fetchErrors?: { policyId: string; policyName: string; policyType: string; familyKey?: string; error: string; statusCode?: number; endpoint?: string; permissionHint?: string; partial?: boolean }[]
  sections?: { familyKey: string; items: any[]; error?: { message: string } }[]
  settingsCatalog: any[]
  deviceConfigurations: any[]
  administrativeTemplates: any[]
  compliancePolicies: any[]
  appProtectionPolicies?: any[]
  securityBaselines: any[]
  scripts: { windows: any[]; macOS: any[] }
  appConfigurations?: any[]
  windowsUpdatePolicies?: any[]
  enrollmentConfigurations?: any[]
  conditionalAccessPolicies?: any[]
  groupNames?: Map<string, string>
  deviceCounts?: Record<string, number>
  branding?: unknown
}

export interface ConfigurationSettingInstance {
  '@odata.type': string
  settingDefinitionId: string
  simpleSettingValue?: { value: any; '@odata.type'?: string }
  simpleSettingCollectionValue?: { value: any; '@odata.type'?: string }[]
  groupSettingValue?: { children: ConfigurationSettingInstance[] }
  groupSettingCollectionValue?: { children: ConfigurationSettingInstance[] }[]
  choiceSettingValue?: { value?: string; children?: ConfigurationSettingInstance[] }
  choiceSettingCollectionValue?: { value?: string; children?: ConfigurationSettingInstance[] }[]
}
