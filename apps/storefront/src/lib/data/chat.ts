"use server"

import { ChatWidgetConfig } from "@lib/interakt/types"
import { INTERAKT_API_URL, INTERAKT_CHAT_TOKEN } from "@lib/util/search-config"

/**
 * Fetches the chat assistant's public display config (name, greeting,
 * suggested questions). Not streamed, so a plain server action rather than a
 * route handler — unlike sending a message, this never needs to hold a
 * connection open.
 *
 * Returns `null` rather than throwing on any failure: the chat panel treats a
 * missing config as "use sensible defaults", not as a hard error.
 */
export async function getChatWidgetConfig(): Promise<ChatWidgetConfig | null> {
  if (!INTERAKT_CHAT_TOKEN) {
    return null
  }

  try {
    const response = await fetch(
      `${INTERAKT_API_URL}/api/v1/ai-experiences/widget-config`,
      {
        headers: { "x-access-token": INTERAKT_CHAT_TOKEN },
        next: { revalidate: 300 },
      }
    )

    if (!response.ok) {
      return null
    }

    const payload = await response.json().catch(() => null)
    if (!payload || payload.success === false) {
      return null
    }

    return payload.data as ChatWidgetConfig
  } catch {
    return null
  }
}
