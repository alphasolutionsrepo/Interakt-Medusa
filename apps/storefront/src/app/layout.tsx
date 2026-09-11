import { getChatWidgetConfig } from "@lib/data/chat"
import { getBaseURL } from "@lib/util/env"
import { isChatEnabled } from "@lib/util/search-config"
import ChatWidget from "@modules/chat/components/chat-widget"
import { Metadata } from "next"
import "styles/globals.css"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const chatEnabled = isChatEnabled()
  const widgetConfig = chatEnabled ? await getChatWidgetConfig() : null

  return (
    <html lang="en" data-mode="light">
      <body>
        <main className="relative">
          {props.children}
          {chatEnabled && <ChatWidget widgetConfig={widgetConfig} />}
        </main>
      </body>
    </html>
  )
}
