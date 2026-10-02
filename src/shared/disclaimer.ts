/**
 * The disclaimer an admin accepts once per tenant before TenuVault first changes that tenant.
 * Changing the text means raising DISCLAIMER_VERSION, so every tenant asks again.
 */
export const DISCLAIMER_VERSION = 1

export const DISCLAIMER_TITLE = "Before you change this tenant"

export const DISCLAIMER_PARAGRAPHS = [
  "TenuVault deploys configuration exactly as you choose it. Framework recommendations, including the OpenIntuneBaseline (OIB) and the CIS Benchmarks, are generic starting points. They are not tailored to your environment and can block sign-ins, apps or devices.",
  "Test every recommended setting in a non-production tenant or with a small pilot group before you apply it to production. The same applies to restores, drift reverts, promotions and every other change TenuVault makes for you. You are responsible for reviewing, testing and rolling out every change you make with TenuVault.",
  "No liability is assumed for the usage or application of the settings within this project in production tenants.",
] as const

export const DISCLAIMER_CONFIRMATIONS = [
  "I have tested these settings in a non-production tenant or with a pilot group.",
  "I understand and accept that no liability is assumed.",
] as const

/** HTTP status the main process answers with when a tenant has not accepted the current disclaimer. */
export const ACKNOWLEDGEMENT_REQUIRED = 428

/** Body of an ACKNOWLEDGEMENT_REQUIRED response. */
export interface AcknowledgementRequired {
  error: string
  acknowledgement: { version: number; tenantIds: string[] }
}

/** One stored acceptance. */
export interface DisclaimerAcknowledgement {
  version: number
  acceptedAt: string
  /** The admin signed in to the tenant when it was accepted, if any. */
  account: string | null
}

export function isAcknowledgementRequired(value: unknown): value is AcknowledgementRequired {
  if (!value || typeof value !== "object") return false
  const ack = (value as { acknowledgement?: unknown }).acknowledgement
  return !!ack && typeof ack === "object" && Array.isArray((ack as { tenantIds?: unknown }).tenantIds)
}
