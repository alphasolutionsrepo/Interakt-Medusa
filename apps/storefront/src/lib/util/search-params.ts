import { Facet, SearchFilter, SearchSort } from "@lib/interakt/types"

/**
 * Search URL <-> Interakt query translation.
 *
 * Kept free of `process.env` so the facet UI can import it on the client.
 * Anything that reads configuration lives in `search-config.ts`, which is
 * server-only.
 */

/**
 * Facet params are prefixed so that a facet field named `q`, `page` or `sortBy`
 * cannot collide with the reserved params and corrupt navigation.
 * `?f_brand=Acme&f_brand=Other&f_gender=Women`
 */
export const FACET_PARAM_PREFIX = "f_"

export const QUERY_PARAM = "q"
export const PAGE_PARAM = "page"
export const SORT_PARAM = "sortBy"

export type SearchSortOption =
  | "relevance"
  | "price_asc"
  | "price_desc"
  | "created_at"

export const SEARCH_SORT_OPTIONS: { value: SearchSortOption; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "created_at", label: "Newest" },
]

/** Selected facet values, keyed by index field name (prefix stripped). */
export type SelectedFacets = Record<string, string[]>

export function parseSelectedFacets(
  params: URLSearchParams | Record<string, string | string[] | undefined>
): SelectedFacets {
  const out: SelectedFacets = {}

  if (params instanceof URLSearchParams) {
    params.forEach((value, key) => {
      if (!key.startsWith(FACET_PARAM_PREFIX) || !value) return
      const field = key.slice(FACET_PARAM_PREFIX.length)
      out[field] = [...(out[field] ?? []), value]
    })
    return out
  }

  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith(FACET_PARAM_PREFIX) || value === undefined) continue
    const field = key.slice(FACET_PARAM_PREFIX.length)
    out[field] = Array.isArray(value) ? value : [value]
  }

  return out
}

/**
 * Selected facets -> Interakt filter clauses.
 *
 * One `in` clause per field rather than N `eq` clauses. The demo emits repeated
 * `eq` and relies on the server OR-ing same-field clauses; `in` states the
 * intent directly and is in the accepted operator set.
 */
export function toFilters(selected: SelectedFacets): SearchFilter[] {
  return Object.entries(selected)
    .filter(([, values]) => values.length > 0)
    .map(([field, values]) => ({
      field,
      operator: values.length === 1 ? "eq" : "in",
      value: values.length === 1 ? values[0] : values,
    }))
}

/**
 * Facets the server auto-generates but a shopper cannot usefully filter on.
 *
 * The index marks these facetable, so omitting the `facets` array from the
 * request (which is what gets us the whole sidebar for free) also returns them.
 * Filtering here rather than enumerating wanted facets in the request keeps new
 * facetable fields appearing automatically.
 *
 * `minPrice`/`maxPrice` are excluded because they come back as *terms* facets —
 * a list of exact prices like `332 (2)`. Filtering to one exact price is not a
 * price filter; that needs a `range` facet, which is a separate change.
 */
const HIDDEN_FACET_FIELDS = new Set([
  "language",
  "currency",
  "createdAt",
  "updatedAt",
  "minPrice",
  "maxPrice",
])

/** Shopper-meaningful order. Anything not listed keeps server order, after these. */
const FACET_ORDER = [
  "category",
  "subCategory",
  "gender",
  "brand",
  "primaryColor",
  "availableSizes",
  "material",
  "style",
  "season",
  "ageGroup",
  "fitTypes",
  "rating",
  "hasDiscount",
  "inStock",
]

/**
 * Drop facets that offer no choice, then order them.
 *
 * A single-bucket facet is noise: every result already shares that value, so
 * ticking it filters nothing. `inStock: [1 (15)]` and `currency: [USD (15)]`
 * are the common cases.
 */
export function usableFacets(facets: Facet[]): Facet[] {
  return facets
    .filter(
      (f) =>
        !HIDDEN_FACET_FIELDS.has(f.field) && (f.buckets?.length ?? 0) > 1
    )
    .sort((a, b) => {
      const ai = FACET_ORDER.indexOf(a.field)
      const bi = FACET_ORDER.indexOf(b.field)
      return (
        (ai === -1 ? FACET_ORDER.length : ai) -
        (bi === -1 ? FACET_ORDER.length : bi)
      )
    })
}

const BOOLEAN_KEYS = new Set(["0", "1", "true", "false"])

/**
 * Whether a facet's buckets are a boolean pair.
 *
 * Decided per facet rather than per bucket: booleans come back as `1`/`0`, and
 * mapping those to Yes/No unconditionally would relabel a genuine numeric
 * bucket — `rating: 1` would render as "Yes".
 */
export function isBooleanFacet(facet: Facet): boolean {
  const keys = facet.buckets.map((b) => String(b.key))
  return keys.length <= 2 && keys.every((k) => BOOLEAN_KEYS.has(k))
}

/** Bucket keys are raw index values; only boolean facets get Yes/No. */
export function formatBucketLabel(
  key: string | number,
  facet: Facet
): string {
  const value = String(key)
  if (!isBooleanFacet(facet)) return value
  return value === "true" || value === "1" ? "Yes" : "No"
}

/** Sort option -> Interakt sort clause. Relevance means sending no sort at all. */
export function toSort(sortBy?: SearchSortOption): SearchSort[] | undefined {
  switch (sortBy) {
    case "price_asc":
      return [{ field: "minPrice", direction: "asc" }]
    case "price_desc":
      return [{ field: "maxPrice", direction: "desc" }]
    case "created_at":
      return [{ field: "createdAt", direction: "desc" }]
    default:
      return undefined
  }
}
