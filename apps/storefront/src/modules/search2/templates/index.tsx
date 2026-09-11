import { getChatWidgetConfig } from "@lib/data/chat"
import { searchProducts } from "@lib/data/search"
import { isSearchNotConfigured } from "@lib/interakt/errors"
import { SearchResponse } from "@lib/interakt/types"
import { isChatEnabled } from "@lib/util/search-config"
import {
  SearchSortOption,
  SelectedFacets,
  toFilters,
  toSort,
} from "@lib/util/search-params"
import { Heading, Text } from "@modules/common/components/ui"
import SearchBox from "@modules/search/components/search-box"
import ChatPanel from "@modules/chat/components/chat-panel"
import FacetAccordion from "@modules/search2/components/facet-accordion"
import ResultsPanel from "@modules/search2/components/results-panel"

type Search2TemplateProps = {
  query: string
  page: number
  sortBy: SearchSortOption
  selectedFacets: SelectedFacets
  countryCode: string
}

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="content-container py-10 small:py-16">{children}</div>
)

/**
 * Combined search + AI chat layout, styled after Interakt's own demo
 * (`experience/combined-experience`): a flexible left column (search bar,
 * facets, results) plus a docked chat panel on the right. Search and chat are
 * two independent Interakt resources with their own config/tokens, so each
 * degrades on its own — a misconfigured chat token never breaks search, and
 * vice versa.
 */
const Search2Template = async ({
  query,
  page,
  sortBy,
  selectedFacets,
  countryCode,
}: Search2TemplateProps) => {
  const trimmed = query.trim()
  const widgetConfig = await getChatWidgetConfig()
  const chatEnabled = isChatEnabled()

  // --- No query yet ----------------------------------------------------------
  if (!trimmed) {
    return (
      <Shell>
        <div className="flex flex-col small:flex-row gap-8">
          <div className="flex-1 min-w-0 flex flex-col items-center gap-6 py-16 text-center">
            <Heading level="h1" className="text-3xl text-ui-fg-base">
              Search
            </Heading>
            <Text className="text-base-regular text-ui-fg-subtle max-w-md">
              Find pieces by name, brand, colour, material or category — or
              just ask the assistant.
            </Text>
            <div className="w-full max-w-2xl">
              <SearchBox
                autoFocus
                basePath="search2"
                data-testid="search2-page-input"
              />
            </div>
          </div>

          <ChatPanel
            enabled={chatEnabled}
            widgetConfig={widgetConfig}
            basePath="search2"
            className="small:w-80 xl:w-96 shrink-0"
          />
        </div>
      </Shell>
    )
  }

  // --- Run the search ----------------------------------------------------------
  let search: SearchResponse | null = null
  let searchError: { notConfigured: boolean } | null = null

  try {
    search = await searchProducts({
      query: trimmed,
      page,
      filters: toFilters(selectedFacets),
      sort: toSort(sortBy),
    })
  } catch (e) {
    searchError = { notConfigured: isSearchNotConfigured(e) }
  }

  return (
    <Shell>
      <div className="flex flex-col small:flex-row gap-8">
        <div className="flex-1 min-w-0 flex flex-col gap-8">
          <div className="w-full max-w-2xl">
            <SearchBox
              initialQuery={trimmed}
              basePath="search2"
              data-testid="search2-page-input"
            />
          </div>

          {searchError ? (
            <div className="flex flex-col gap-2 py-10">
              <Text className="text-large-semi text-ui-fg-base">
                {searchError.notConfigured
                  ? "Search isn't configured yet"
                  : "Search is temporarily unavailable"}
              </Text>
              <Text className="text-base-regular text-ui-fg-subtle">
                {searchError.notConfigured
                  ? "Set INTERAKT_SEARCH_TOKEN in apps/storefront/.env.local, then restart the dev server."
                  : "We couldn't reach the search service. Please try again in a moment."}
              </Text>
            </div>
          ) : (
            <div className="flex flex-col small:flex-row gap-8 small:gap-12">
              <FacetAccordion facets={search!.facets ?? []} sortBy={sortBy} />
              <ResultsPanel
                search={search!}
                query={trimmed}
                page={page}
                countryCode={countryCode}
              />
            </div>
          )}
        </div>

        <ChatPanel
          enabled={chatEnabled}
          widgetConfig={widgetConfig}
          basePath="search2"
          className="small:w-80 xl:w-96 shrink-0 small:sticky small:top-8 small:self-start"
        />
      </div>
    </Shell>
  )
}

export default Search2Template
