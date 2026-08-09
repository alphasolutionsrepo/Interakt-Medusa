import { INTERAKT_API_URL, INTERAKT_SEARCH_TOKEN } from "@lib/util/search-config"
import { NextRequest } from "next/server"

/**
 * SSE proxy for Interakt's AI summary.
 *
 * A route handler rather than a server action because the summary streams:
 * the browser needs an incrementally readable body, and INTERAKT_SEARCH_TOKEN
 * must not reach the browser. This holds the token server-side and pipes the
 * upstream event stream straight through.
 *
 * The storefront's middleware matcher excludes `/api`, so this is not subject
 * to the country-code redirect.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Enough context for a useful summary without a large upstream prompt. */
const MAX_RESULTS = 10
const MAX_QUERY_LENGTH = 200

/**
 * Fixed server-side. The upstream API accepts a free-form `instruction`, and
 * accepting one from the client would turn this route — which carries our
 * credentials — into an open prompt endpoint for someone else's LLM bill.
 */
const INSTRUCTION =
  "After your summary, on a new line write FOLLOW_UP: followed by exactly 3 short follow-up search queries separated by |"

type SummaryRequestBody = {
  query?: unknown
  totalResults?: unknown
  results?: unknown
}

export async function POST(request: NextRequest) {
  if (!INTERAKT_SEARCH_TOKEN) {
    return Response.json(
      { error: "Search is not configured" },
      { status: 503 }
    )
  }

  let body: SummaryRequestBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const query = typeof body.query === "string" ? body.query.trim() : ""
  const results = Array.isArray(body.results) ? body.results : []

  if (!query || !results.length) {
    return Response.json(
      { error: "query and results are required" },
      { status: 400 }
    )
  }

  let upstream: Response
  try {
    upstream = await fetch(`${INTERAKT_API_URL}/api/v1/summarize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "x-access-token": INTERAKT_SEARCH_TOKEN,
      },
      body: JSON.stringify({
        query: query.slice(0, MAX_QUERY_LENGTH),
        results: results.slice(0, MAX_RESULTS),
        totalResults:
          typeof body.totalResults === "number" ? body.totalResults : results.length,
        instruction: INSTRUCTION,
      }),
      // Propagate the browser disconnecting upstream, so an abandoned search
      // stops generating rather than running to completion on our tab.
      signal: request.signal,
    })
  } catch {
    return Response.json({ error: "Summary service unreachable" }, { status: 502 })
  }

  if (!upstream.ok || !upstream.body) {
    // 403 here means AI summary is disabled on the search experience.
    const detail = await upstream.text().catch(() => "")
    return Response.json(
      { error: `Summary unavailable (${upstream.status})`, detail: detail.slice(0, 500) },
      { status: upstream.status === 403 ? 403 : 502 }
    )
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Without this, a buffering proxy holds the whole stream until it ends,
      // which turns a streamed summary back into a slow single blob.
      "x-accel-buffering": "no",
    },
  })
}
