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
import { Checkbox, Text, clx } from "@modules/common/components/ui"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"

/** Buckets shown before a facet group collapses behind "Show all". */
const VISIBLE_BUCKETS = 8

type SearchFacetsProps = {
  facets: Facet[]
  sortBy: SearchSortOption
}

const SearchFacets = ({ facets, sortBy }: SearchFacetsProps) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  /**
   * Same shape as the store's RefinementList: mutate a copy of the params, drop
   * `page` so a narrowed result set never lands the user on a page that no
   * longer exists, and skip the push when nothing actually changed.
   */
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

  const selectedCount = Array.from(searchParams.keys()).filter((k) =>
    k.startsWith(FACET_PARAM_PREFIX)
  ).length

  const visibleFacets = usableFacets(facets)

  return (
    <div className="flex flex-col gap-8 small:min-w-[250px] small:max-w-[250px] py-4">
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

      {selectedCount > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className="self-start text-small-regular text-ui-fg-interactive hover:underline"
        >
          Clear all filters ({selectedCount})
        </button>
      )}

      {visibleFacets.map((facet) => (
        <div key={facet.field} className="flex flex-col gap-3">
          <Text className="txt-compact-small-plus text-ui-fg-muted uppercase tracking-wider">
            {/* Server-supplied label. The demo ignores this and reimplements
                humanisation with a hardcoded map in two separate files. */}
            {facet.label ?? facet.field}
          </Text>

          <div className="flex flex-col gap-2">
            {facet.buckets.slice(0, VISIBLE_BUCKETS).map((bucket) => {
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

            {facet.buckets.length > VISIBLE_BUCKETS && (
              <Text className="text-small-regular text-ui-fg-muted">
                +{facet.buckets.length - VISIBLE_BUCKETS} more
              </Text>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default SearchFacets
