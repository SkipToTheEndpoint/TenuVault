import { isGuid } from "../../../../../shared/security"
import { type NextRequest, NextResponse } from "next/server"

const METADATA_CONTAINER = "tenant-metadata"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      tenantId, 
      appId, 
      clientSecret,
      storageAccountName
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

    // Get access token for Azure Storage
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
      // Don't treat auth failure as metadata not existing
      // Return exists: false to allow normal flow
      console.error("Azure auth failed during metadata check")
      return NextResponse.json({ 
        exists: false,
        error: "Authentication failed"
      })
    }

    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.access_token

    // Check if metadata blob exists using HEAD request (lighter than GET)
    const blobUrl = `https://${storageAccountName}.blob.core.windows.net/${METADATA_CONTAINER}/${encodeURIComponent(tenantId)}/metadata.json`
    
    const checkResponse = await fetch(blobUrl, {
      method: 'HEAD',
      headers: {
        'x-ms-version': '2021-12-02',
        'x-ms-date': new Date().toUTCString(),
        'Authorization': `Bearer ${accessToken}`,
      },
    })

    if (checkResponse.ok) {
      // Metadata exists
      const lastModified = checkResponse.headers.get('Last-Modified')
      const contentLength = checkResponse.headers.get('Content-Length')
      
      return NextResponse.json({ 
        exists: true,
        lastModified,
        size: contentLength,
        message: "Metadata found for this tenant"
      })
    } else if (checkResponse.status === 404) {
      // No metadata found
      return NextResponse.json({ 
        exists: false,
        message: "No metadata found for this tenant"
      })
    } else {
      // Some other error - treat as not existing to allow normal flow
      console.error("Error checking metadata existence:", checkResponse.status)
      return NextResponse.json({ 
        exists: false,
        error: "Could not verify metadata existence"
      })
    }

  } catch (error) {
    console.error("Error checking tenant metadata:", error)
    // Don't block the flow - return exists: false
    return NextResponse.json({ 
      exists: false,
      error: "Internal server error"
    })
  }
}