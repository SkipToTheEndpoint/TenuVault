/**
 * Minimal stand-in for `next/server` so the portal's API route modules
 * (written as Next.js route handlers) run inside the Electron main process. The build aliases `next/server`
 * to this file (see electron.vite.config.ts).
 */

export class NextRequest extends Request {
  readonly nextUrl: URL

  constructor(input: string | URL | Request, init?: RequestInit) {
    super(input, init)
    this.nextUrl = new URL(this.url)
  }
}

export class NextResponse<Body = unknown> extends Response {
  /** Type-only marker matching Next's generic response body parameter. */
  declare readonly __body?: Body

  static override json<JsonBody>(body: JsonBody, init?: ResponseInit): NextResponse<JsonBody> {
    const headers = new Headers(init?.headers)
    if (!headers.has("content-type")) headers.set("content-type", "application/json")
    return new NextResponse<JsonBody>(JSON.stringify(body), { ...init, headers })
  }

  static next(init?: ResponseInit): NextResponse {
    return new NextResponse(null, init)
  }

  static override redirect(url: string | URL, init?: number | ResponseInit): NextResponse {
    const status = typeof init === "number" ? init : (init?.status ?? 307)
    return new NextResponse(null, { status, headers: { location: String(url) } })
  }
}
