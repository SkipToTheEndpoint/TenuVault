import type { ComplianceAssessment } from './types'

export const FRAMEWORK_SOURCE_COMMIT = '38998301541c06a6a4a2f6e099277a6c39eb84f6'
export const FRAMEWORK_USAGE_NOTICE = 'Independent TenuVault configuration mapping. Framework names and identifiers are factual references. No publisher affiliation, endorsement, audit opinion, certification or complete compliance assessment is implied. Expected values are our technical interpretation. A configuration match does not prove effective access or device enforcement.'

export interface NativeAssessment {
  schemaVersion: 1
  runId: string
  tenantId: string
  frameworkId: string
  sourceCommit: string
  snapshotSha256: string
  rulesetSha256: string
  licenseNotice: string
  assessment: ComplianceAssessment
}

export function comparisonCounts(run: NativeAssessment) {
  const counts = { matches: 0, different: 0, missing: 0, unableToCheck: 0, outsideScope: 0 }
  for (const result of run.assessment.capabilities) for (const check of result.checks) {
    if (check.assessmentStatus !== 'checked') counts[check.assessmentStatus]++
    else if (check.result) counts[check.result]++
  }
  for (const control of run.assessment.frameworks[0]?.controls ?? []) if (control.unavailableCheck) counts[control.unavailableCheck.assessmentStatus === 'outsideScope' ? 'outsideScope' : 'unableToCheck']++
  return counts
}

export function nativeChecksCSV(run: NativeAssessment): string {
  const quote = (value: unknown) => {
    let text = String(value ?? '')
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`
    return `"${text.replace(/"/g, '""')}"`
  }
  const rows: unknown[][] = [['Framework', 'Mapping version', 'Capability', 'Setting', 'Status', 'Expected', 'Observed', 'Policy ID', 'Policy name', 'Assignment', 'Reason']]
  for (const cap of run.assessment.capabilities) for (const c of cap.checks) rows.push([run.frameworkId, run.assessment.provenance.rulesetVersion, cap.capability.name, c.settingId, c.assessmentStatus === 'checked' ? c.result : c.assessmentStatus, c.expectedValue, c.actualValue, c.policyId, c.policyName, c.assignment?.state, c.reason])
  return rows.map(row => row.map(quote).join(',')).join('\r\n')
}

export function compareNativeAssessments(previous: NativeAssessment, current: NativeAssessment) {
  const normalizeScope = (run: NativeAssessment) => JSON.stringify({ ...run.assessment.scope, platforms: [...(run.assessment.scope.platforms ?? [])].sort() })
  if (previous.tenantId !== current.tenantId || previous.frameworkId !== current.frameworkId) throw new Error('Choose comparisons for the same tenant and framework.')
  if (previous.rulesetSha256 !== current.rulesetSha256 || normalizeScope(previous) !== normalizeScope(current)) throw new Error('Scope or ruleset changed. These runs cannot be compared as tenant configuration drift.')
  const observations = (run: NativeAssessment) => {
    const entries = new Map<string, string[]>()
    for (const cap of run.assessment.capabilities) for (const check of cap.checks) {
      const key = `${cap.capability.id}:${check.settingId}:${check.policyId ?? ''}`
      const values = entries.get(key) ?? []
      values.push(JSON.stringify({ status: check.assessmentStatus, result: check.result, expected: check.expectedValue, observed: check.actualValue, assignment: check.assignment }))
      entries.set(key, values)
    }
    return new Map([...entries].map(([key, values]) => [key, JSON.stringify(values.sort())]))
  }
  const before = observations(previous), after = observations(current)
  return [...new Set([...before.keys(), ...after.keys()])].filter(key => before.get(key) !== after.get(key)).map(key => ({ setting: key, previous: before.get(key) ?? 'Not observed', current: after.get(key) ?? 'Not observed' }))
}
