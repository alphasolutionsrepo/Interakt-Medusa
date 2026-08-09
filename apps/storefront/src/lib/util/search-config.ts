import { SearchType } from "@lib/interakt/types"

/**
 * Search feature configuration.
 *
 * Deliberately NOT registered in check-env-variables.js: that list calls
 * process.exit(1) on a missing key, which would make search config a hard boot
 * requirement for the entire storefront.
 */

export const INTERAKT_API_URL =
  process.env.INTERAKT_API_URL || "http://localhost:3000"

export const INTERAKT_SEARCH_TOKEN = process.env.INTERAKT_SEARCH_TOKEN

/**
 * The index is provisioned as `hybrid` with 1536-dim embeddings, but every
 * document was indexed without them (the embedding provider is out of credits),
 * so the vector half of a hybrid query matches nothing. Pin to lexical until
 * that is resolved, then flip this env var.
 */
export const INTERAKT_SEARCH_TYPE = (process.env.INTERAKT_SEARCH_TYPE ||
  "lexical") as SearchType

/**
 * Whether to show search entry points.
 *
 * Gates on the token as well as the flag: a search box rendered without a
 * configured backend leads straight to a broken results page, which is worse
 * than no search box at all.
 */
export const isSearchEnabled = (): boolean =>
  process.env.NEXT_PUBLIC_SEARCH_ENABLED !== "false" && !!INTERAKT_SEARCH_TOKEN

/**
 * Results per page.
 *
 * Deliberately double the store templates' PRODUCT_LIMIT of 12 — a search
 * result set is scanned, not browsed, so more tiles per page means less
 * paging. The upstream ceiling is 100, further capped by the search
 * experience's own maxPageSize.
 */
export const SEARCH_PAGE_SIZE = 24
