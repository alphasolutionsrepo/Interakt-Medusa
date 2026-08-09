"use client"

import { QUERY_PARAM } from "@lib/util/search-params"
import { Sparkles } from "@medusajs/icons"
import { Text, clx } from "@modules/common/components/ui"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"

/** Below this, a summary says less than the results themselves. Matches the demo. */
const MIN_RESULTS_FOR_SUMMARY = 3

/** One search hit, trimmed to what the model needs. */
export type SummarySource = {
  id: string
  index: { id: string; name: string }
  fields: Record<string, unknown>
}

type AiSummaryProps = {
  query: string
  results: SummarySource[]
  totalResults: number
}

type StreamEvent =
  | { type: "content"; text: string }
  | { type: "error"; error: string }
  | { type: "done" }
  | { type: "sources" }

const AiSummary = ({ query, results, totalResults }: AiSummaryProps) => {
  const router = useRouter()
  const { countryCode } = useParams() as { countryCode: string }

  const [summary, setSummary] = useState("")
  const [followUps, setFollowUps] = useState<string[]>([])
  /**
   * Starts true when a summary is going to be requested, so the server render
   * already contains the skeleton. Initialising it to false would render
   * nothing on the server and pop the box in after hydration, shoving the
   * result grid down the page.
   */
  const [isStreaming, setIsStreaming] = useState(
    totalResults >= MIN_RESULTS_FOR_SUMMARY
  )
  const [failed, setFailed] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  // Identity of the request, so the effect re-runs when the query or the result
  // set changes but not when the array is merely re-created by a re-render.
  const resultKey = results.map((r) => r.id).join(",")

  const run = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setSummary("")
    setFollowUps([])
    setFailed(false)
    setIsStreaming(true)

    try {
      const response = await fetch("/api/search-summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, results, totalResults }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        setFailed(true)
        setIsStreaming(false)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let text = ""

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        // The last element is whatever arrived mid-line; keep it for next time.
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const payload = line.slice(6)
          if (payload === "[DONE]") continue

          let event: StreamEvent
          try {
            event = JSON.parse(payload)
          } catch {
            // A partial JSON frame. Dropping it is correct — the next read
            // delivers the rest, and buffer handling already covers the split.
            continue
          }

          // `sources` arrives first and is not rendered here; the result grid
          // below already shows the products.
          if (event.type === "content") {
            text += event.text
            setSummary(text)
          } else if (event.type === "error") {
            setFailed(true)
          }
        }
      }

      // The model is asked to append `FOLLOW_UP: a|b|c`. Strip it out of the
      // prose and turn it into chips.
      const match = text.match(/FOLLOW_UP:\s*(.+)/i)
      if (match) {
        setFollowUps(
          match[1]
            .split("|")
            .map((q) => q.trim())
            .filter((q) => q.length > 0 && q.length < 100)
            .slice(0, 3)
        )
        setSummary(text.replace(/\n?\s*FOLLOW_UP:\s*.+/i, "").trim())
      }
    } catch (e) {
      // An abort is the expected path when the query changes mid-stream.
      if ((e as Error)?.name !== "AbortError") {
        setFailed(true)
      }
    } finally {
      setIsStreaming(false)
    }
  }, [query, results, totalResults])

  useEffect(() => {
    if (totalResults < MIN_RESULTS_FOR_SUMMARY) return

    run()
    return () => abortRef.current?.abort()
    // `resultKey` stands in for `results`; `run` changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, resultKey, totalResults])

  if (totalResults < MIN_RESULTS_FOR_SUMMARY) {
    return null
  }

  // Nothing to show until the first token lands. A failed summary is silent —
  // it is an enhancement, and an error banner above the results would imply
  // the search itself failed when it did not.
  if (failed || (!summary && !isStreaming)) {
    return null
  }

  return (
    <div className="w-full rounded-2xl border border-ui-border-base bg-ui-bg-subtle px-5 py-4">
      <div className="flex items-center gap-2 pb-2">
        <Sparkles className="text-ui-fg-muted" />
        <Text className="txt-compact-small-plus uppercase tracking-wider text-ui-fg-muted">
          AI summary
        </Text>
      </div>

      {summary ? (
        <Text className="text-base-regular text-ui-fg-base whitespace-pre-wrap">
          {summary}
          {isStreaming && (
            <span className="inline-block w-[2px] h-[1em] align-[-0.15em] ml-0.5 bg-ui-fg-base animate-pulse" />
          )}
        </Text>
      ) : (
        <div className="flex flex-col gap-2 py-1">
          <div className="h-3 w-3/4 rounded bg-ui-bg-base animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-ui-bg-base animate-pulse" />
        </div>
      )}

      {followUps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-4">
          {followUps.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() =>
                router.push(
                  `/${countryCode}/search?${QUERY_PARAM}=${encodeURIComponent(q)}`
                )
              }
              className={clx(
                "rounded-full border border-ui-border-base bg-white px-4 py-1.5",
                "text-small-regular text-ui-fg-subtle transition-colors hover:bg-gray-50 hover:text-ui-fg-base"
              )}
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default AiSummary
