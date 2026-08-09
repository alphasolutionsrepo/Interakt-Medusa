import {
  PAGE_PARAM,
  QUERY_PARAM,
  SORT_PARAM,
  SearchSortOption,
  parseSelectedFacets,
} from "@lib/util/search-params"
import SearchTemplate from "@modules/search/templates"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Search",
  description: "Search the catalogue by name, brand, colour, material or category.",
}

type SearchPageSearchParams = Record<string, string | string[] | undefined> & {
  [QUERY_PARAM]?: string
  [PAGE_PARAM]?: string
  [SORT_PARAM]?: SearchSortOption
}

type Params = {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<SearchPageSearchParams>
}

/**
 * The route stays thin: resolve params, hand off to the template.
 *
 * Not gated by NEXT_PUBLIC_SEARCH_ENABLED — that flag hides the entry points,
 * so a bookmarked or shared search URL keeps working while the box is off.
 */
export default async function SearchPage(props: Params) {
  const { countryCode } = await props.params
  const searchParams = await props.searchParams

  const query = searchParams[QUERY_PARAM] ?? ""
  const page = Math.max(Number(searchParams[PAGE_PARAM]) || 1, 1)
  const sortBy = (searchParams[SORT_PARAM] ?? "relevance") as SearchSortOption

  return (
    <SearchTemplate
      query={Array.isArray(query) ? query[0] : query}
      page={page}
      sortBy={sortBy}
      selectedFacets={parseSelectedFacets(searchParams)}
      countryCode={countryCode}
    />
  )
}
