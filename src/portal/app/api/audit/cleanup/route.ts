import { isGuid } from "../../../../../shared/security"
import { type NextRequest, NextResponse } from "next/server"
import { AuditStorageService } from "~/lib/audit/storage"

async function getAccessToken(tenantId: string, appId: string, clientSecret: string): Promise<string> {
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
    throw new Error("Failed to authenticate")
  }

  const tokenData = await tokenResponse.json()
  return tokenData.access_token
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      tenantId, 
      appId, 
      clientSecret, 
      storageAccountName,
      retentionDays
    } = body

    if (!tenantId || !appId || !clientSecret || !storageAccountName) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      )
    }
    if (!isGuid(tenantId)) {
      return NextResponse.json({ error: "Invalid tenant ID" }, { status: 400 })
    }
    const days = retentionDays ?? 90
    if (!Number.isInteger(days) || days < 30 || days > 3650) {
      return NextResponse.json({ error: "Retention must be between 30 and 3650 days" }, { status: 400 })
    }

    // Get access token for Azure Storage
    const accessToken = await getAccessToken(tenantId, appId, clientSecret)

    // Create storage service
    const storageService = new AuditStorageService({
      storageAccountName,
      accessToken,
    })

    // Only this tenant's files are deleted; any failed read or delete fails the request.
    const { deleted, kept } = await storageService.cleanupOldLogs(tenantId, days)

    return NextResponse.json({
      success: true,
      deleted,
      kept,
      message: `Removed ${deleted} audit file${deleted === 1 ? "" : "s"} older than ${days} days${kept ? `; kept ${kept} that also hold entries of another tenant or of no tenant` : ""}.`,
    })

  } catch (error) {
    console.error("Audit cleanup error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? `Audit cleanup failed: ${error.message}` : "Audit cleanup failed" },
      { status: 500 }
    )
  }
}