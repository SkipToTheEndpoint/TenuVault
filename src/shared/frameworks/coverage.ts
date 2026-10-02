import type { BaselinePolicy } from './policies'
export const COVERAGE_VERSION = 1
export const UNSUPPORTED = ['Compliance policies', 'Update rings', 'Legacy security baseline templates', 'Application deployment', 'Device enforcement and applicability', 'Organizational controls and manual audit evidence']
export function packCoverage(policies: BaselinePolicy[]) {
  return {
    schemaVersion: COVERAGE_VERSION,
    supportedFamilies: ['Settings Catalog'],
    unsupported: UNSUPPORTED,
    manualEvidence: ['Profile selection and approval', 'Organizational safeguards', 'Device-side validation'],
    certification: false,
    mappings: policies.flatMap((policy, policyIndex) => policy.settings.map((setting, settingIndex) => ({
      policyIndex, settingIndex, policy: policy.name,
      settingDefinitionId: (setting.settingInstance as Record<string, unknown>).settingDefinitionId,
      provenance: policy.provenance ?? { source: 'Administrator-supplied policy JSON', version: 'Administrator reference required', verification: 'unverified' },
      coverage: 'Configuration comparison only; not a control crosswalk',
    }))),
  }
}
