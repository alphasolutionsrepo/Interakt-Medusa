"use client"

import { GridLayout, ListBullet } from "@medusajs/icons"
import { Text, clx } from "@modules/common/components/ui"
import { useState } from "react"

type ViewMode = "grid" | "list"

type ViewToggleProps = {
  resultCount: number
  missing: number
  query: string
  /** Pre-rendered `ProductPreview` cards — rendering stays server-side, this just lays them out. */
  children: React.ReactNode
}

/**
 * Owns only the grid/list layout choice. `children` are already-rendered
 * server components (`ProductPreview` is itself async), so this stays a thin
 * client island rather than needing the product-fetch logic to move client-side.
 */
const ViewToggle = ({ resultCount, missing, query, children }: ViewToggleProps) => {
  const [mode, setMode] = useState<ViewMode>("grid")

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <Text className="text-base-regular text-ui-fg-subtle">
          {resultCount.toLocaleString()}{" "}
          {resultCount === 1 ? "result" : "results"} for{" "}
          <span className="text-ui-fg-base">&ldquo;{query}&rdquo;</span>
          {missing > 0 && (
            <span className="text-ui-fg-muted"> ({missing} no longer available)</span>
          )}
        </Text>

        <div className="flex items-center gap-0.5 rounded-lg bg-ui-bg-subtle p-0.5">
          <button
            type="button"
            aria-label="Grid view"
            aria-pressed={mode === "grid"}
            onClick={() => setMode("grid")}
            className={clx(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              mode === "grid"
                ? "bg-white text-ui-fg-base shadow-elevation-card-rest"
                : "text-ui-fg-muted"
            )}
          >
            <GridLayout />
          </button>
          <button
            type="button"
            aria-label="List view"
            aria-pressed={mode === "list"}
            onClick={() => setMode("list")}
            className={clx(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              mode === "list"
                ? "bg-white text-ui-fg-base shadow-elevation-card-rest"
                : "text-ui-fg-muted"
            )}
          >
            <ListBullet />
          </button>
        </div>
      </div>

      <ul
        className={clx(
          "w-full",
          mode === "grid"
            ? "grid grid-cols-2 medium:grid-cols-3 gap-x-6 gap-y-8"
            : "flex flex-col gap-4 max-w-md"
        )}
        data-testid="search2-results-list"
      >
        {children}
      </ul>
    </div>
  )
}

export default ViewToggle
