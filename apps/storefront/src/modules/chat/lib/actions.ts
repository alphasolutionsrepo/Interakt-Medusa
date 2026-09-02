import { z } from "zod"

/**
 * "Page control" protocol for the chat assistant.
 *
 * Interakt's chat pipeline has no concept of client-side tools or per-visitor
 * session context (confirmed by reading its pipeline code) — every tool call
 * it makes is server-side, synchronous, and has no way to know which browser
 * tab it's talking to. So instead of a real tool-calling integration, the
 * assistant's persona instructions (set on the "Medusa Fashion Assistant" AI
 * Experience) tell it to end a reply with a fenced ` ```action ` block
 * whenever the user's message asks for one of these four things. We parse
 * that block out of the streamed text and execute it ourselves.
 */

const navigateProductAction = z.object({
  type: z.literal("navigate_product"),
  productId: z.string().min(1),
})

const navigateSearchAction = z.object({
  type: z.literal("navigate_search"),
  query: z.string().min(1),
  filters: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
})

const addToCartAction = z.object({
  type: z.literal("add_to_cart"),
  productId: z.string().min(1),
  sku: z.string().optional(),
  quantity: z.number().int().positive().max(10).optional(),
})

const navigateCheckoutAction = z.object({
  type: z.literal("navigate_checkout"),
})

export const chatActionSchema = z.discriminatedUnion("type", [
  navigateProductAction,
  navigateSearchAction,
  addToCartAction,
  navigateCheckoutAction,
])

export type ChatAction = z.infer<typeof chatActionSchema>

/** A complete fenced action block: ` ```action\n{...}\n``` `. */
const COMPLETE_FENCE_RE = /```action\s*\n([\s\S]*?)\n```/g
/** A fence that has opened but not yet closed — mid-stream. Hidden, not executed. */
const INCOMPLETE_FENCE_RE = /```action[\s\S]*$/

/**
 * Pulls any action blocks out of a (possibly still-streaming) assistant
 * message, validates each, and returns the text with those blocks removed so
 * the user never sees the raw JSON — including the brief window where a fence
 * has opened but its closing ``` hasn't arrived yet.
 *
 * Invalid JSON or a shape that doesn't match the schema is dropped silently:
 * a malformed action must never crash the chat, and a still-arriving fence
 * looks identical to a malformed one until it closes.
 */
export function extractActions(content: string): {
  actions: ChatAction[]
  cleanedContent: string
} {
  const actions: ChatAction[] = []

  const withoutComplete = content.replace(COMPLETE_FENCE_RE, (_match, jsonText) => {
    try {
      const parsed = chatActionSchema.safeParse(JSON.parse(jsonText))
      if (parsed.success) {
        actions.push(parsed.data)
      }
    } catch {
      // Not valid JSON — ignore.
    }
    return ""
  })

  const cleanedContent = withoutComplete.replace(INCOMPLETE_FENCE_RE, "").trim()

  return { actions, cleanedContent }
}

/** Stable dedupe key so the same action never executes twice across re-renders. */
export function actionKey(action: ChatAction): string {
  return JSON.stringify(action)
}
