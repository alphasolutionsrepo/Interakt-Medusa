/**
 * Types for Interakt's public search API (`/api/v1/*`).
 *
 * Written against the backend's Zod schemas
 * (`search-experience.schemas.ts`, `autocomplete.service.ts`), NOT against the
 * demo site's own types — the demo is wrong in three places:
 *
 *   - it sends `limit` to autocomplete, but the schema takes `maxSuggestions`
 *     and silently drops unknown keys, so its suggestion count never applied
 *   - it types the suggestion highlight as `highlights?: string[]`; the server
 *     returns `highlight?: string`
 *   - it ignores the server-supplied `facets[].label` and reimplements
 *     humanisation with a hardcoded map duplicated across two files
 */

export type SearchType = "lexical" | "semantic" | "hybrid" | "auto"

export interface SearchFilter {
  field: string
  /** `eq neq gt gte lt lte in nin contains prefix exists missing range` */
  operator: string
  value: unknown
}

export interface SearchSort {
  field: string
  /** Note: `direction`, not `order` — the public endpoint differs from the internal one. */
  direction: "asc" | "desc"
}

export interface SearchRequest {
  query: string
  page?: number
  pageSize?: number
  searchType?: SearchType
  filters?: SearchFilter[]
  /** Omit entirely and the server auto-generates terms facets from every facetable field. */
  facets?: { field: string; type?: string; size?: number }[]
  sort?: SearchSort[]
}

export interface SearchResultHit {
  id: string
  score: number
  source: Record<string, unknown>
  highlights?: Record<string, string[]>
}

export interface FacetBucket {
  key: string | number
  count: number
}

export interface Facet {
  field: string
  type: string
  /** Human label from the server. Use this rather than humanising `field` locally. */
  label?: string
  buckets: FacetBucket[]
}

export interface SearchPagination {
  page: number
  pageSize: number
  totalPages: number
  totalItems: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

export interface SearchResponse {
  results: SearchResultHit[]
  total: { value: number; relation: "eq" | "gte" }
  pagination: SearchPagination
  facets?: Facet[]
  took: number
}

export interface AutocompleteSuggestion {
  text: string
  score: number
  field: string
  indexId: string
  indexName: string
  /** Singular, and `<mark>`-tagged HTML. We render `text` instead. */
  highlight?: string
}

export interface AutocompleteResponse {
  suggestions: AutocompleteSuggestion[]
  query: string
  took: number
}

/**
 * What the search box renders.
 *
 * Deliberately leaner than `AutocompleteSuggestion`: suggestions can come from
 * either the dedicated autocomplete endpoint or from product names, and the UI
 * only needs the text plus an optional id for a stable React key.
 */
export interface SearchSuggestion {
  text: string
  /** Present when the suggestion came from a matched product. */
  productId?: string
}

/** Every `/api/v1` response is wrapped in this. */
export type ApiEnvelope<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string; details?: unknown }

/**
 * Public config for an AI Experience's chat widget (`/api/v1/ai-experiences/widget-config`).
 */
export interface ChatWidgetConfig {
  name: string
  greeting?: string
  description?: string
  suggestedQuestions?: string[]
  placeholder?: string
  showBranding?: boolean
}

/**
 * One frame of the chat SSE stream (`/api/v1/ai-experiences/chat`).
 *
 * Deliberately loose rather than a strict discriminated union: this is an
 * agentic pipeline with more event types than we react to (`step_complete`,
 * `action_step`, …), and the exact fields on a given type aren't guaranteed
 * stable across pipeline versions. We only read `type` plus the handful of
 * fields the "solid core" chat panel actually uses; anything else is ignored
 * rather than failing to parse.
 */
export interface ChatSSEEvent {
  type: string
  text?: string
  message?: string
  sessionId?: string
  stepName?: string
  [key: string]: unknown
}
