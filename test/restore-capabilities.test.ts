import { describe, expect, it } from 'vitest'
import { typeForFolder } from '../src/shared/intune/registry'
import { buildRestorePlan, buildUpdatePlan, restoreCapabilities } from '../src/shared/intune/restore-plan'

describe('default object restore capabilities', () => {
  it.each([
    ['EnrollmentConfigurations', { id: 'default', displayName: 'Default', priority: 0, '@odata.type': '#microsoft.graph.deviceEnrollmentLimitConfiguration', limit: 5 }],
    ['Branding', { id: 'default', displayName: 'Default', isDefaultProfile: true }],
  ] as const)('allows replacing %s but rejects creation', (folder, snapshot) => {
    const type = typeForFolder(folder)!
    expect(restoreCapabilities(type, snapshot)).toEqual({ blocker: expect.stringContaining('default'), replaceBlocker: undefined })
    expect(() => buildRestorePlan(type, snapshot)).toThrow()
    expect(buildUpdatePlan(type, snapshot, snapshot.id)[0]).toMatchObject({ method: 'PATCH', path: `${type.path}/default` })
    expect(restoreCapabilities(type, { ...snapshot, id: '' }).replaceBlocker).toContain('original object ID')
  })
})

it('checks administrative-template replacement with snapshot data and then the actual current object', () => {
  const type = typeForFolder('GroupPolicyConfigurations')!
  const snapshot = { id: 'template', displayName: 'Template', definitionValues: [] }
  expect(restoreCapabilities(type, snapshot).replaceBlocker).toBeUndefined()
  expect(restoreCapabilities(type, snapshot, { definitionValues: [] }).replaceBlocker).toBeUndefined()
  expect(restoreCapabilities(type, snapshot, {}).replaceBlocker).toContain('could not be read')
})
