import { type NextRequest, NextResponse } from "next/server"
import { PROGRESS_ID, readProgress } from "~/lib/policies/restore-progress"

/** POST /api/restore-backup/progress { progressId } -> the running restore's progress. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { progressId?: unknown }
  const id = typeof body.progressId === "string" && PROGRESS_ID.test(body.progressId) ? body.progressId : null
  const progress = id ? readProgress(id) : undefined
  if (!progress) return NextResponse.json({ error: "This restore is not running." }, { status: 404 })
  return NextResponse.json(progress)
}
