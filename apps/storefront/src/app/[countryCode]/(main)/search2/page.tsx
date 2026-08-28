import {
  PAGE_PARAM,
  QUERY_PARAM,
  SORT_PARAM,
  SearchSortOption,
  parseSelectedFacets,
} from "@lib/util/search-params"
import Search2Template from "@modules/search2/templates"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Search",
  description:
    "Search the catalogue by name, brand, colour, material or category, or ask the AI assistant.",
}

type Search2PageSearchParams = Record<string, string | string[] | undefined> & {
  [QUERY_PARAM]?: string
  [PAGE_PARAM]?: string
  [SORT_PARAM]?: SearchSortOption
}

type Params = {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<Search2PageSearchParams>
}

/**
 * Standalone comparison page for the combined search + chat layout — not
 * linked from navigation. See `/search` for the production search page; this
 * route stays thin the same way, handing off to its own template.
 */
export default async function Search2Page(props: Params) {
  const { countryCode } = await props.params
  const searchParams = await props.searchParams

  const query = searchParams[QUERY_PARAM] ?? ""
  const page = Math.max(Number(searchParams[PAGE_PARAM]) || 1, 1)
  const sortBy = (searchParams[SORT_PARAM] ?? "relevance") as SearchSortOption

  return (
    <Search2Template
      query={Array.isArray(query) ? query[0] : query}
      page={page}
      sortBy={sortBy}
      selectedFacets={parseSelectedFacets(searchParams)}
      countryCode={countryCode}
    />
  )
}
