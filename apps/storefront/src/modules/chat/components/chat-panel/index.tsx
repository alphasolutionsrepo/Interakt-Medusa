"use client"

import { useSpeechRecognition } from "@lib/hooks/use-speech-recognition"
import { ChatSSEEvent, ChatWidgetConfig } from "@lib/interakt/types"
import { ChatBubbleLeftRight, CircleArrowUp, Sparkles, Spinner, XMark } from "@medusajs/icons"
import { Text, clx } from "@modules/common/components/ui"
import Microphone from "@modules/common/icons/microphone"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import Markdown from "react-markdown"
import { actionKey, extractActions } from "../../lib/actions"
import { executeChatAction } from "../../lib/execute-action"

const FALLBACK_SUGGESTIONS = [
  "Show me winter jackets",
  "What's trending right now?",
]

type ChatMessage = {
  role: "user" | "assistant"
  content: string
  /** True while an assistant message is still receiving tokens. */
  pending?: boolean
  /** Short receipt of a page-control action the assistant triggered from this message, e.g. "📦 Added to your cart". */
  actionNote?: string
}

type ChatPanelProps = {
  enabled: boolean
  widgetConfig: ChatWidgetConfig | null
  className?: string
  /** Renders a close (X) button in the header when provided — for a floating/popover host. Docked usage (e.g. /search2) omits it. */
  onClose?: () => void
  /** Route segment navigate_search pushes to — "search" or "search2", matching whichever page hosts this chat. */
  basePath?: string
}

/**
 * Markdown elements get a light Tailwind pass rather than pulling in
 * @tailwindcss/typography for one panel — assistant replies are short enough
 * (a few paragraphs, a list, an inline product image) that hand-picked
 * classes cover it.
 */
const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-base-regular text-ui-fg-base leading-relaxed">{children}</p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-ui-fg-base">{children}</strong>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-5 flex flex-col gap-1">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-5 flex flex-col gap-1">{children}</ol>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-ui-fg-interactive underline"
    >
      {children}
    </a>
  ),
  img: ({ src, alt }: { src?: string; alt?: string }) =>
    typeof src === "string" ? (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary upstream host, not worth a next.config.js allowlist entry for a chat panel
      <img
        src={src}
        alt={alt ?? ""}
        className="mt-2 max-w-[220px] rounded-large border border-ui-border-base"
      />
    ) : null,
}

/** Kept short — this rides along on every follow-up message's token cost. */
const MAX_RECAP_ASSISTANT_LENGTH = 400

/**
 * Interakt's chat API takes only `{message, sessionId}` — there's no separate
 * history field — so the only way to guarantee the model has what it needs is
 * to fold it into the message text itself. This is a deliberate safety net
 * alongside `sessionId` continuation, not a replacement for it: when session
 * memory works, this is redundant; when it doesn't (observed intermittently,
 * cause not yet pinned down), the current turn still carries enough to
 * resolve "it"/"that one" against the last thing discussed.
 */
function buildContextRecap(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 1; i--) {
    if (messages[i].role !== "assistant" || messages[i - 1].role !== "user") {
      continue
    }

    const userText = messages[i - 1].content.trim()
    const assistantText = messages[i].content
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // strip markdown image syntax — pure noise here
      .trim()
      .slice(0, MAX_RECAP_ASSISTANT_LENGTH)

    if (!userText || !assistantText) return null

    return `[Earlier in this conversation:\nYou: ${userText}\nAssistant: ${assistantText}]`
  }

  return null
}

const ChatPanel = ({
  enabled,
  widgetConfig,
  className,
  onClose,
  basePath = "search",
}: ChatPanelProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [statusLabel, setStatusLabel] = useState<string | null>(null)
  const sessionIdRef = useRef<string | undefined>(undefined)
  const router = useRouter()
  const { countryCode } = useParams() as { countryCode: string }
  const scrollAnchorRef = useRef<HTMLDivElement>(null)
  const speech = useSpeechRecognition()

  // Keyed by basePath so the floating widget and /search2's docked panel —
  // already independent conversations — persist independently too.
  const storageKey = `chat:${basePath}`

  // Keep the latest message (including one still streaming in) in view —
  // otherwise a reply arrives below the fold and the visitor has to notice
  // and scroll down themselves before they can read it or reply.
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ block: "end" })
  }, [messages, statusLabel])

  // Restore a conversation left over from before a remount — sessionStorage
  // isn't available during SSR, so this has to be a post-mount effect rather
  // than a lazy useState initializer. A one-frame flash from empty to
  // restored on reopen is an acceptable trade-off for that.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        messages?: ChatMessage[]
        sessionId?: string
      }
      if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
        setMessages(parsed.messages)
      }
      if (parsed.sessionId) {
        sessionIdRef.current = parsed.sessionId
      }
    } catch {
      // Corrupt or inaccessible storage — just start fresh.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist on every change, so the conversation survives whatever caused an
  // in-memory reset (a remount we haven't pinned down, a reload, a browser
  // back/forward) rather than only avoiding the one cause we could identify.
  useEffect(() => {
    if (messages.length === 0) return
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ messages, sessionId: sessionIdRef.current })
      )
    } catch {
      // Storage full/unavailable (private browsing, etc.) — conversation
      // just won't survive a reset; not worth failing anything over.
    }
  }, [messages, storageKey])

  const assistantName = widgetConfig?.name || "Fashion Assistant"
  const greeting = widgetConfig?.greeting || `Hi! I'm ${assistantName}.`
  const description =
    widgetConfig?.description ||
    "Ask me anything about our products — styles, materials, prices, whatever you're after."
  const suggestions = widgetConfig?.suggestedQuestions?.length
    ? widgetConfig.suggestedQuestions
    : FALLBACK_SUGGESTIONS
  const placeholder = widgetConfig?.placeholder || "Ask about our products…"

  const send = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return

    if (messages.length > 0 && !sessionIdRef.current) {
      // Should be unreachable — sessionIdRef is set from the prior turn's
      // `done` event before the input re-enables. If this ever fires, it
      // confirms a follow-up went out as a brand new conversation, which
      // reads to the assistant as if it had never seen any prior message.
      console.warn(
        "[chat] sending a follow-up with no session id — conversation context will be lost",
        { basePath }
      )
    }

    // Captured from the pre-send transcript — a safety net so this turn
    // carries what it needs even if session-based memory doesn't.
    const recap = messages.length >= 2 ? buildContextRecap(messages) : null
    const outgoingMessage = recap ? `${recap}\n\n${trimmed}` : trimmed

    setInput("")
    setMessages((prev) => [
      ...prev,
      { role: "user", content: trimmed },
      { role: "assistant", content: "", pending: true },
    ])
    setIsStreaming(true)
    setStatusLabel("Thinking…")

    const setAssistantContent = (content: string) => {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role === "assistant") {
          next[next.length - 1] = { ...last, content, pending: false }
        }
        return next
      })
    }

    const setAssistantNote = (note: string) => {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role === "assistant") {
          next[next.length - 1] = { ...last, actionNote: note }
        }
        return next
      })
    }

    // Raw (unstripped) accumulated text for this turn — action fences are
    // parsed out of this, not out of what's rendered, so a fence split across
    // multiple `content` chunks still gets recognized once it's complete.
    let rawBuffer = ""
    const executedThisTurn = new Set<string>()

    const appendToAssistant = (chunk: string) => {
      rawBuffer += chunk
      const { actions, cleanedContent } = extractActions(rawBuffer)
      setAssistantContent(cleanedContent)

      for (const action of actions) {
        const key = actionKey(action)
        if (executedThisTurn.has(key)) continue
        executedThisTurn.add(key)

        executeChatAction(action, { router, countryCode, basePath })
          .then((note) => {
            if (note) setAssistantNote(note)
          })
          .catch(() => setAssistantNote("Something went wrong with that."))
      }
    }

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: outgoingMessage,
          sessionId: sessionIdRef.current,
        }),
      })

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null)
        setAssistantContent(
          payload?.error
            ? `Something went wrong: ${payload.error}`
            : "Something went wrong — try again."
        )
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split("\n\n")
        buffer = frames.pop() ?? ""

        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "))
          if (!line) continue

          let event: ChatSSEEvent
          try {
            event = JSON.parse(line.slice(6))
          } catch {
            continue
          }

          switch (event.type) {
            case "step_start":
              setStatusLabel(event.stepName || "Working…")
              break
            case "tool_call":
              setStatusLabel("Searching catalog…")
              break
            case "content":
              if (typeof event.text === "string") {
                setStatusLabel(null)
                appendToAssistant(event.text)
              }
              break
            case "done":
              if (event.sessionId) {
                sessionIdRef.current = event.sessionId
              }
              setStatusLabel(null)
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last?.role === "assistant") {
                  next[next.length - 1] = { ...last, pending: false }
                }
                return next
              })
              break
            case "error":
              setAssistantContent(
                typeof event.message === "string"
                  ? event.message
                  : "Something went wrong — try again."
              )
              break
          }
        }
      }
    } catch {
      setAssistantContent("Something went wrong — try again.")
    } finally {
      setIsStreaming(false)
      setStatusLabel(null)
    }
  }

  if (!enabled) {
    return (
      <div
        className={clx(
          "flex flex-col items-center justify-center gap-2 rounded-large border border-ui-border-base bg-ui-bg-subtle p-6 text-center",
          className
        )}
      >
        <ChatBubbleLeftRight className="text-ui-fg-muted" />
        <Text className="text-base-regular text-ui-fg-base">
          Chat isn&apos;t configured
        </Text>
        <Text className="text-small-regular text-ui-fg-subtle">
          Set INTERAKT_CHAT_TOKEN in apps/storefront/.env.local, then restart
          the dev server.
        </Text>
      </div>
    )
  }

  return (
    <div
      className={clx(
        "flex flex-col rounded-large border border-ui-border-base bg-white overflow-hidden",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-ui-border-base px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black text-white">
          <Sparkles />
        </span>
        <Text className="flex-1 txt-compact-small-plus text-ui-fg-base">
          {assistantName}
        </Text>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="flex h-7 w-7 items-center justify-center rounded-full text-ui-fg-muted transition-colors hover:bg-ui-bg-subtle hover:text-ui-fg-base"
          >
            <XMark />
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Text className="text-base-regular text-ui-fg-base">{greeting}</Text>
              <Text className="text-small-regular text-ui-fg-subtle">
                {description}
              </Text>
            </div>
            <div className="flex flex-col gap-2">
              {suggestions.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => send(question)}
                  className="self-start rounded-full border border-ui-border-base bg-ui-bg-subtle px-3 py-1.5 text-small-regular text-ui-fg-base transition-colors hover:border-ui-border-interactive"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, i) => (
          <div
            key={i}
            className={clx(
              "flex",
              message.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            {message.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-black px-4 py-2 text-white text-base-regular">
                {message.content}
              </div>
            ) : (
              <div className="flex max-w-[90%] gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ui-bg-subtle text-ui-fg-muted">
                  <Sparkles />
                </span>
                <div className="flex flex-col gap-1">
                  {message.content ? (
                    <Markdown components={markdownComponents}>
                      {message.content}
                    </Markdown>
                  ) : message.pending ? (
                    <span className="flex items-center gap-2 text-small-regular text-ui-fg-muted">
                      <Spinner className="animate-spin" />
                      {statusLabel ?? "Thinking…"}
                    </span>
                  ) : null}
                  {message.actionNote && (
                    <Text className="text-small-regular text-ui-fg-muted">
                      {message.actionNote}
                    </Text>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={scrollAnchorRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
        className="flex items-center gap-2 border-t border-ui-border-base px-3 py-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          disabled={isStreaming}
          className="flex-1 h-10 rounded-full border border-ui-border-base bg-ui-bg-subtle px-4 text-base-regular text-ui-fg-base placeholder:text-ui-fg-muted focus:outline-none disabled:opacity-60"
        />
        {speech.isSupported && (
          <button
            type="button"
            disabled={isStreaming}
            aria-label={speech.isListening ? "Stop voice input" : "Speak your message"}
            aria-pressed={speech.isListening}
            onClick={() =>
              speech.isListening
                ? speech.stop()
                : speech.start((transcript) => setInput(transcript))
            }
            className={clx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40",
              speech.isListening
                ? "bg-red-500 text-white animate-pulse"
                : "text-ui-fg-muted hover:bg-ui-bg-subtle"
            )}
          >
            <Microphone size={18} />
          </button>
        )}
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          aria-label="Send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black text-white transition-opacity disabled:opacity-40"
        >
          <CircleArrowUp />
        </button>
      </form>
    </div>
  )
}

export default ChatPanel
