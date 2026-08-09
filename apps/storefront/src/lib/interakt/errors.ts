/**
 * Lives outside `lib/data/search.ts` because a `"use server"` module may only
 * export async functions — exporting a class from one is a build error.
 */
export class SearchNotConfiguredError extends Error {
  constructor() {
    super(
      "Search is not configured. Set INTERAKT_SEARCH_TOKEN in apps/storefront/.env.local."
    )
    this.name = "SearchNotConfiguredError"
  }
}

export const isSearchNotConfigured = (e: unknown): boolean =>
  e instanceof Error && e.name === "SearchNotConfiguredError"
