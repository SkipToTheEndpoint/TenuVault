import type { Json } from "../intune/registry"

/** Replaces %OrganizationId% (any case) with the tenant ID in every string of a policy. */
export function replaceTenantVariables<T extends Json>(value: T, tenantId: string): T {
  const walk = (node: Json): Json => {
    if (typeof node === "string") return node.replace(/%OrganizationId%/gi, tenantId)
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]))
    return node
  }
  return walk(value) as T
}
