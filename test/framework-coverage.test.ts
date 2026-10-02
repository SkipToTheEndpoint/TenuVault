import { expect, it } from 'vitest'
import { packCoverage } from '../src/shared/frameworks/coverage'
import { parsePolicies, remediationPayload } from '../src/shared/frameworks/policies'
it('preserves versioned source mappings while excluding provenance from Graph payloads', () => {
  const provenance = { schemaVersion: 1, publisher: 'Contoso', source: 'https://example.com/baseline.json', version: '3.8', license: 'GPL-3.0', verification: 'Source declaration' }
  const policy = parsePolicies({ name: 'Baseline', platforms: 'windows10', technologies: 'mdm', provenance, settings: [{ settingInstance: { '@odata.type': '#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance', settingDefinitionId: 'test' } }] })[0]!
  const coverage = packCoverage([policy])
  expect(coverage).toMatchObject({ schemaVersion: 1, certification: false, mappings: [{ settingDefinitionId: 'test', provenance: { version: '3.8', license: 'GPL-3.0' } }] })
  expect(coverage.unsupported).toContain('Device enforcement and applicability')
  expect(remediationPayload(policy, policy.settings, 'v1')).not.toHaveProperty('provenance')
})
