"use client"

import { Facet } from "@lib/interakt/types"
import {
  FACET_PARAM_PREFIX,
  PAGE_PARAM,
  SEARCH_SORT_OPTIONS,
  SORT_PARAM,
  SearchSortOption,
  formatBucketLabel,
  usableFacets,
} from "@lib/util/search-params"
import { ChevronDownMini } from "@medusajs/icons"
import { Checkbox, Text, clx } from "@modules/common/components/ui"
import * as Accordion from "@radix-ui/react-accordion"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useMemo, useState } from "react"

/** A facet with more buckets than this gets its own "Search…" filter input. */
const SEARCH_WITHIN_THRESHOLD = 8
/** Buckets shown before a facet group collapses behind "+N more". */
const VISIBLE_BUCKETS = 12

type FacetAccordionProps = {
  facets: Facet[]
  sortBy: SearchSortOption
}

/**
 * Visually restyled sibling of `SearchFacets` (collapsible sections instead of
 * a flat list) for the /search2 layout. Same URL-param read/write logic —
 * intentionally duplicated rather than shared, since the two are independent
 * pages that happen to look different; see `SearchFacets` for the canonical
 * version this was adapted from.
 */
const FacetAccordion = ({ facets, sortBy }: FacetAccordionProps) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const visibleFacets = useMemo(() => usableFacets(facets), [facets])
  const [openItems, setOpenItems] = useState<string[]>(() =>
    visibleFacets.map((f) => f.field)
  )
  const [withinFilter, setWithinFilter] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const updateQueryParams = useCallback(
    (updater: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString())
      updater(params)
      params.delete(PAGE_PARAM)

      const nextQuery = params.toString()
      const currentQuery = searchParams.toString()
      if (nextQuery === currentQuery) return

      router.push(nextQuery ? `${pathname}?${nextQuery}` : pathname)
    },
    [pathname, router, searchParams]
  )

  const toggleFacet = (field: string, value: string) =>
    updateQueryParams((params) => {
      const key = `${FACET_PARAM_PREFIX}${field}`
      const current = params.getAll(key)
      params.delete(key)
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      next.forEach((v) => params.append(key, v))
    })

  const clearAll = () =>
    updateQueryParams((params) => {
      for (const key of Array.from(params.keys())) {
        if (key.startsWith(FACET_PARAM_PREFIX)) {
          params.delete(key)
        }
      }
    })

  const isSelected = (field: string, value: string) =>
    searchParams.getAll(`${FACET_PARAM_PREFIX}${field}`).includes(value)

  const selectedCountFor = (field: string) =>
    searchParams.getAll(`${FACET_PARAM_PREFIX}${field}`).length

  const totalSelectedCount = Array.from(searchParams.keys()).filter((k) =>
    k.startsWith(FACET_PARAM_PREFIX)
  ).length

  return (
    <div className="flex flex-col gap-6 small:min-w-[240px] small:max-w-[240px]">
      {/* Sort */}
      <div className="flex flex-col gap-3">
        <Text className="txt-compact-small-plus text-ui-fg-muted uppercase tracking-wider">
          Sort by
        </Text>
        <div className="flex flex-col gap-2">
          {SEARCH_SORT_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2 cursor-pointer"
            >
              <input
                type="radio"
                name={SORT_PARAM}
                checked={sortBy === option.value}
                onChange={() =>
                  updateQueryParams((params) =>
                    option.value === "relevance"
                      ? params.delete(SORT_PARAM)
                      : params.set(SORT_PARAM, option.value)
                  )
                }
                className="accent-black"
              />
              <Text className="text-base-regular text-ui-fg-subtle">
                {option.label}
              </Text>
            </label>
          ))}
        </div>
      </div>

      {totalSelectedCount > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className="self-start text-small-regular text-ui-fg-interactive hover:underline"
        >
          Clear all filters ({totalSelectedCount})
        </button>
      )}

      <Accordion.Root
        type="multiple"
        value={openItems}
        onValueChange={setOpenItems}
        className="flex flex-col"
      >
        {visibleFacets.map((facet) => {
          const isOpen = openItems.includes(facet.field)
          const selectedCount = selectedCountFor(facet.field)
          const filterText = withinFilter[facet.field] ?? ""
          const isExpanded = expanded[facet.field] ?? false

          const filteredBuckets = filterText
            ? facet.buckets.filter((b) =>
                formatBucketLabel(b.key, facet)
                  .toLowerCase()
                  .includes(filterText.toLowerCase())
              )
            : facet.buckets

          const shownBuckets = isExpanded
            ? filteredBuckets
            : filteredBuckets.slice(0, VISIBLE_BUCKETS)

          return (
            <Accordion.Item
              key={facet.field}
              value={facet.field}
              className="border-b border-ui-border-base py-3 last:border-b-0"
            >
              <Accordion.Header>
                <Accordion.Trigger className="flex w-full items-center justify-between gap-2 text-left">
                  <span className="flex items-center gap-2">
                    <Text className="txt-compact-small-plus text-ui-fg-base">
                      {facet.label ?? facet.field}
                    </Text>
                    {selectedCount > 0 && (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ui-bg-base-pressed px-1.5 text-xs text-ui-fg-base">
                        {selectedCount}
                      </span>
                    )}
                  </span>
                  <span
                    className={clx(
                      "text-ui-fg-muted transition-transform duration-150",
                      isOpen && "rotate-180"
                    )}
                  >
                    <ChevronDownMini />
                  </span>
                </Accordion.Trigger>
              </Accordion.Header>

              <Accordion.Content className="pt-3">
                <div className="flex flex-col gap-2">
                  {facet.buckets.length > SEARCH_WITHIN_THRESHOLD && (
                    <input
                      type="text"
                      value={filterText}
                      onChange={(e) =>
                        setWithinFilter((prev) => ({
                          ...prev,
                          [facet.field]: e.target.value,
                        }))
                      }
                      placeholder="Search…"
                      className="h-8 w-full rounded-md border border-ui-border-base px-2 text-small-regular text-ui-fg-base placeholder:text-ui-fg-muted focus:outline-none"
                    />
                  )}

                  {shownBuckets.map((bucket) => {
                    const value = String(bucket.key)
                    const checked = isSelected(facet.field, value)

                    return (
                      <label
                        key={value}
                        className="flex items-center gap-2 cursor-pointer group"
                      >
                        <Checkbox
                          checked={checked}
                          onChange={() => toggleFacet(facet.field, value)}
                        />
                        <Text
                          className={clx(
                            "text-base-regular flex-1 truncate",
                            checked ? "text-ui-fg-base" : "text-ui-fg-subtle"
                          )}
                          title={formatBucketLabel(bucket.key, facet)}
                        >
                          {formatBucketLabel(bucket.key, facet)}
                        </Text>
                        <Text className="text-small-regular text-ui-fg-muted tabular-nums">
                          {bucket.count}
                        </Text>
                      </label>
                    )
                  })}

                  {!isExpanded && filteredBuckets.length > VISIBLE_BUCKETS && (
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => ({
                          ...prev,
                          [facet.field]: true,
                        }))
                      }
                      className="self-start text-small-regular text-ui-fg-interactive hover:underline"
                    >
                      +{filteredBuckets.length - VISIBLE_BUCKETS} more options
                    </button>
                  )}
                </div>
              </Accordion.Content>
            </Accordion.Item>
          )
        })}
      </Accordion.Root>
    </div>
  )
}

export default FacetAccordion
