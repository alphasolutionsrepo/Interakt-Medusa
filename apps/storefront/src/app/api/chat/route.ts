import { INTERAKT_API_URL, INTERAKT_CHAT_TOKEN } from "@lib/util/search-config"
import { NextRequest } from "next/server"

/**
 * SSE proxy for the /search2 chat assistant.
 *
 * A route handler rather than a server action because chat streams: the
 * browser needs an incrementally readable body, and INTERAKT_CHAT_TOKEN must
 * not reach the browser. This holds the token server-side and pipes the
 * upstream event stream straight through — same pattern as
 * `/api/search-summary` for the AI summary feature.
 *
 * The storefront's middleware matcher excludes `/api`, so this is not subject
 * to the country-code redirect.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ChatRequestBody = {
  message?: unknown
  sessionId?: unknown
}

export async function POST(request: NextRequest) {
  if (!INTERAKT_CHAT_TOKEN) {
    return Response.json({ error: "Chat is not configured" }, { status: 503 })
  }

  let body: ChatRequestBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const message = typeof body.message === "string" ? body.message.trim() : ""
  const sessionId =
    typeof body.sessionId === "string" ? body.sessionId : undefined

  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 })
  }

  let upstream: Response
  try {
    upstream = await fetch(`${INTERAKT_API_URL}/api/v1/ai-experiences/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "x-access-token": INTERAKT_CHAT_TOKEN,
      },
      body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
      // Propagate the browser disconnecting upstream, so an abandoned chat
      // stops generating rather than running to completion on our tab.
      signal: request.signal,
    })
  } catch {
    return Response.json({ error: "Chat service unreachable" }, { status: 502 })
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "")
    return Response.json(
      {
        error: `Chat unavailable (${upstream.status})`,
        detail: detail.slice(0, 500),
      },
      { status: upstream.status || 502 }
    )
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Without this, a buffering proxy holds the whole stream until it ends,
      // which turns a streamed reply back into a slow single blob.
      "x-accel-buffering": "no",
    },
  })
}
