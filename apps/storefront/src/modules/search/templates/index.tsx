import { searchProducts } from "@lib/data/search"
import { isSearchNotConfigured } from "@lib/interakt/errors"
import { SearchResponse } from "@lib/interakt/types"
import {
  SearchSortOption,
  SelectedFacets,
  toFilters,
  toSort,
} from "@lib/util/search-params"
import { Heading, Text } from "@modules/common/components/ui"
import AiSummary, {
  SummarySource,
} from "@modules/search/components/ai-summary"
import SearchBox from "@modules/search/components/search-box"
import SearchFacets from "@modules/search/components/search-facets"
import SearchResults from "@modules/search/components/search-results"

/**
 * Fields handed to the summariser.
 *
 * A whitelist rather than the whole `source`: the prompt is billed by token,
 * and `variants` alone would dominate it with SKUs and stock counts that say
 * nothing useful about what the results are.
 */
const SUMMARY_FIELDS = [
  "name",
  "brand",
  "category",
  "subCategory",
  "gender",
  "season",
  "style",
  "material",
  "primaryColor",
  "minPrice",
  "maxPrice",
  "shortDescription",
] as const

type SearchTemplateProps = {
  query: string
  page: number
  sortBy: SearchSortOption
  selectedFacets: SelectedFacets
  countryCode: string
}

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="content-container py-10 small:py-16">{children}</div>
)

const SearchTemplate = async ({
  query,
  page,
  sortBy,
  selectedFacets,
  countryCode,
}: SearchTemplateProps) => {
  const trimmed = query.trim()

  // --- No query yet --------------------------------------------------------
  if (!trimmed) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-6 py-16 text-center">
          <Heading level="h1" className="text-3xl text-ui-fg-base">
            Search
          </Heading>
          <Text className="text-base-regular text-ui-fg-subtle max-w-md">
            Find pieces by name, brand, colour, material or category.
          </Text>
          <div className="w-full max-w-2xl">
            <SearchBox autoFocus data-testid="search-page-input" />
          </div>
        </div>
      </Shell>
    )
  }

  // --- Run the search ------------------------------------------------------
  let search: SearchResponse
  try {
    search = await searchProducts({
      query: trimmed,
      page,
      filters: toFilters(selectedFacets),
      sort: toSort(sortBy),
    })
  } catch (e) {
    // A search backend that is misconfigured or down must degrade to a readable
    // page, not a crashed route — the rest of the storefront is unaffected.
    const notConfigured = isSearchNotConfigured(e)

    return (
      <Shell>
        <div className="flex flex-col gap-6 max-w-2xl mx-auto">
          <SearchBox initialQuery={trimmed} />
          <div className="flex flex-col gap-2 py-10">
            <Text className="text-large-semi text-ui-fg-base">
              {notConfigured
                ? "Search isn't configured yet"
                : "Search is temporarily unavailable"}
            </Text>
            <Text className="text-base-regular text-ui-fg-subtle">
              {notConfigured
                ? "Set INTERAKT_SEARCH_TOKEN in apps/storefront/.env.local, then restart the dev server."
                : "We couldn't reach the search service. Please try again in a moment."}
            </Text>
          </div>
        </div>
      </Shell>
    )
  }

  const summarySources: SummarySource[] = search.results.slice(0, 10).map((hit) => ({
    id: String(hit.source.productId ?? hit.id),
    index: { id: "medusa", name: "medusa-fashion-catalog" },
    fields: Object.fromEntries(
      SUMMARY_FIELDS.filter((f) => hit.source[f] !== null && hit.source[f] !== undefined).map(
        (f) => [f, hit.source[f]]
      )
    ),
  }))

  return (
    <Shell>
      <div className="flex flex-col gap-8">
        <div className="w-full max-w-2xl mx-auto">
          <SearchBox initialQuery={trimmed} data-testid="search-page-input" />
        </div>

        <AiSummary
          query={trimmed}
          results={summarySources}
          totalResults={search.pagination.totalItems}
        />

        <div className="flex flex-col small:flex-row gap-8 small:gap-12">
          <SearchFacets facets={search.facets ?? []} sortBy={sortBy} />
          <SearchResults
            search={search}
            query={trimmed}
            page={page}
            countryCode={countryCode}
          />
        </div>
      </div>
    </Shell>
  )
}

export default SearchTemplate
