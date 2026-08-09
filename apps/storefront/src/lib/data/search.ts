"use server"

import {
  ApiEnvelope,
  AutocompleteResponse,
  AutocompleteSuggestion,
  SearchFilter,
  SearchRequest,
  SearchResponse,
  SearchSort,
  SearchSuggestion,
} from "@lib/interakt/types"
import { SearchNotConfiguredError } from "@lib/interakt/errors"
import {
  INTERAKT_API_URL,
  INTERAKT_SEARCH_TOKEN,
  INTERAKT_SEARCH_TYPE,
  SEARCH_PAGE_SIZE,
} from "@lib/util/search-config"

/**
 * Interakt search, called server-side.
 *
 * Uses raw `fetch` rather than `sdk.client.fetch`: Interakt is not Medusa, so
 * the publishable key, `getAuthHeaders()` and the `getCacheOptions()` tag
 * scheme all belong to a different backend and would be wrong here.
 *
 * Keeping this server-side is what lets INTERAKT_SEARCH_TOKEN stay out of the
 * browser bundle and off the experience's CORS allowlist.
 */

async function post<T>(
  path: string,
  body: unknown,
  revalidate: number
): Promise<T> {
  if (!INTERAKT_SEARCH_TOKEN) {
    throw new SearchNotConfiguredError()
  }

  const response = await fetch(`${INTERAKT_API_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-access-token": INTERAKT_SEARCH_TOKEN,
    },
    body: JSON.stringify(body),
    next: { revalidate },
  })

  const payload = (await response
    .json()
    .catch(() => null)) as ApiEnvelope<T> | null

  if (!response.ok || !payload || payload.success === false) {
    const detail =
      payload && payload.success === false ? payload.error : response.statusText
    throw new Error(`Search request failed (${response.status}): ${detail}`)
  }

  return payload.data
}

export type SearchProductsParams = {
  query: string
  page?: number
  filters?: SearchFilter[]
  sort?: SearchSort[]
}

export async function searchProducts({
  query,
  page = 1,
  filters,
  sort,
}: SearchProductsParams): Promise<SearchResponse> {
  const request: SearchRequest = {
    query,
    page,
    pageSize: SEARCH_PAGE_SIZE,
    searchType: INTERAKT_SEARCH_TYPE,
    // `facets` is deliberately omitted: the server then auto-generates terms
    // facets from every facetable field on the index, which is exactly the
    // sidebar we want and saves hardcoding the field list in two places.
    ...(filters?.length ? { filters } : {}),
    ...(sort?.length ? { sort } : {}),
  }

  return post<SearchResponse>("/api/v1/search", request, 60)
}

/**
 * Type-ahead suggestions.
 *
 * Two sources, in order of preference:
 *
 * 1. `/api/v1/autocomplete` — the purpose-built endpoint. It returns nothing
 *    unless a field on the index carries `isAutocomplete: true`, which ours
 *    currently does not, so today this always yields an empty list. Tried first
 *    anyway so that enabling the flag upgrades the UX with no code change.
 *
 * 2. Matching product names from `/api/v1/search`. The experience's search
 *    config prefix-matches — "jac" already returns every jacket — so partial
 *    words work without the autocomplete analyzer.
 *
 * The fallback costs a second round trip, but only while (1) is unconfigured,
 * and (1) short-circuits server-side in about a millisecond when it is.
 */
export async function autocompleteSuggestions(
  query: string,
  maxSuggestions = 8
): Promise<SearchSuggestion[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) {
    return []
  }

  try {
    // `maxSuggestions`, NOT `limit` — the request schema is non-strict, so a
    // wrong key is dropped silently rather than erroring.
    const data = await post<AutocompleteResponse>(
      "/api/v1/autocomplete",
      { query: trimmed, maxSuggestions },
      300
    )

    const terms = (data.suggestions ?? [])
      .map((s: AutocompleteSuggestion) => ({ text: s.text }))
      .filter((s) => !!s.text)

    if (terms.length) {
      return terms.slice(0, maxSuggestions)
    }
  } catch {
    // Fall through to the product-name path.
  }

  try {
    const results = await post<SearchResponse>(
      "/api/v1/search",
      {
        query: trimmed,
        page: 1,
        pageSize: maxSuggestions,
        searchType: INTERAKT_SEARCH_TYPE,
      },
      300
    )

    const seen = new Set<string>()
    const suggestions: SearchSuggestion[] = []

    for (const hit of results.results ?? []) {
      const text = typeof hit.source.name === "string" ? hit.source.name.trim() : ""
      // Distinct names only: a product with several indexed variants would
      // otherwise fill the dropdown with the same line repeated.
      if (!text || seen.has(text.toLowerCase())) continue
      seen.add(text.toLowerCase())
      suggestions.push({
        text,
        productId:
          typeof hit.source.productId === "string" ? hit.source.productId : undefined,
      })
    }

    return suggestions.slice(0, maxSuggestions)
  } catch {
    // Type-ahead is a convenience. A failure must not interrupt typing — the
    // user can still submit the query they already have.
    return []
  }
}
