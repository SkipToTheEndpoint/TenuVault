import type { Item, Json } from './registry'

// Service-wide definitions are portable. Tenant objects must have a target mapping.
const PORTABLE_IDS = new Set(['templateId', 'settingDefinitionId', 'definitionId', 'presentationId', 'bundleId', 'packageId', 'productId'])

/** Validate the actual outbound payload, after read-only data and assignments were removed. */
export function unresolvedDependencies(body: Item, targetIds: ReadonlySet<string>): string[] {
  const unresolved = new Set<string>()
  const check = (value: Json, key: string, path: string): void => {
    if (Array.isArray(value)) { value.forEach((entry, index) => check(entry, key, `${path}[${index}]`)); return }
    if (value && typeof value === 'object') {
      for (const [child, entry] of Object.entries(value)) check(entry, child, `${path}.${child}`)
      return
    }
    if (typeof value !== 'string' || !value || value === '0') return
    if (PORTABLE_IDS.has(key)) return
    if (key === '@odata.id' || key.endsWith('@odata.bind')) {
      // ADMX definitions and their presentations are Microsoft service-wide objects.
      if (value.startsWith('https://graph.microsoft.com/beta/deviceManagement/groupPolicyDefinitions')) return
      const id = value.match(/(?:\/|\(')([^/'()]+)(?:'\))?$/)?.[1]
      if (!id || !targetIds.has(id)) unresolved.add(path)
    } else if (/(?:Id|Ids)$/.test(key) && !targetIds.has(value)) {
      unresolved.add(path)
    }
  }
  check(body, '', 'snapshot')
  return [...unresolved]
}
