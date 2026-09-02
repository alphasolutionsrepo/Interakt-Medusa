"use client"

import { ChatWidgetConfig } from "@lib/interakt/types"
import { ChatBubbleLeftRight, XMark } from "@medusajs/icons"
import { clx } from "@modules/common/components/ui"
import { usePathname } from "next/navigation"
import { useState } from "react"
import ChatPanel from "../chat-panel"

type ChatWidgetProps = {
  widgetConfig: ChatWidgetConfig | null
}

/**
 * Floating launcher + popover, mounted once in the root layout so it survives
 * client-side navigation to any page — the whole point being that a
 * conversation continues across the assistant's own page-control actions
 * (e.g. navigate_product). Wraps the same `ChatPanel` used docked on
 * /search2 — the panel doesn't know or care whether it's docked or floating.
 *
 * Not rendered at all when chat is unconfigured (see the root layout): a
 * launcher that opens to "chat isn't configured" is worse than no launcher.
 */
const ChatWidget = ({ widgetConfig }: ChatWidgetProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()

  // /search2 has its own docked ChatPanel already visible inline — showing
  // the floating launcher on top of it would just duplicate the assistant.
  if (pathname?.split("/")[2] === "search2") {
    return null
  }

  return (
    <>
      <div
        className={clx(
          // top-20 anchors this just below the site header (h-16) with a
          // small gap, so the panel fills nearly the full viewport height
          // instead of being capped at a few hundred pixels.
          "fixed bottom-24 top-20 right-6 z-50 w-[380px] max-w-[calc(100vw-3rem)] origin-bottom-right transition-all duration-200 ease-out",
          isOpen
            ? "opacity-100 scale-100 pointer-events-auto"
            : "opacity-0 scale-95 pointer-events-none"
        )}
      >
        <ChatPanel
          enabled
          widgetConfig={widgetConfig}
          onClose={() => setIsOpen(false)}
          basePath="search"
          className="h-full shadow-elevation-flyout"
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
