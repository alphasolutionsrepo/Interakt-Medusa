"use client"

import { ChatWidgetConfig } from "@lib/interakt/types"
import { ChatBubbleLeftRight, XMark } from "@medusajs/icons"
import { clx } from "@modules/common/components/ui"
import { useState } from "react"
import ChatPanel from "../chat-panel"

type ChatWidgetProps = {
  widgetConfig: ChatWidgetConfig | null
}

/**
 * Floating launcher + popover, the pattern shoppers already know from Intercom
 * / Drift-style site widgets. Wraps the same `ChatPanel` used docked on
 * /search2 — the panel doesn't know or care whether it's docked or floating.
 *
 * Not rendered at all when chat is unconfigured (see the /search template):
 * a launcher that opens to "chat isn't configured" is worse than no launcher.
 */
const ChatWidget = ({ widgetConfig }: ChatWidgetProps) => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <div
        className={clx(
          "fixed bottom-24 right-6 z-50 w-[380px] max-w-[calc(100vw-3rem)] origin-bottom-right transition-all duration-200 ease-out",
          isOpen
            ? "opacity-100 scale-100 pointer-events-auto"
            : "opacity-0 scale-95 pointer-events-none"
        )}
      >
        <ChatPanel
          enabled
          widgetConfig={widgetConfig}
          onClose={() => setIsOpen(false)}
          className="shadow-elevation-flyout"
        />
      </div>

      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={isOpen ? "Close chat" : "Chat with us"}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-black text-white shadow-elevation-flyout transition-transform hover:scale-105"
      >
        {isOpen ? <XMark /> : <ChatBubbleLeftRight />}
      </button>
    </>
  )
}

export default ChatWidget
