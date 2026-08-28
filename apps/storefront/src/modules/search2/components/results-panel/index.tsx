import { listProducts } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import { SearchResponse } from "@lib/interakt/types"
import { HttpTypes } from "@medusajs/types"
import { Text } from "@modules/common/components/ui"
import ProductPreview from "@modules/products/components/product-preview"
import { Pagination } from "@modules/store/components/pagination"
import ViewToggle from "./view-toggle"

type ResultsPanelProps = {
  search: SearchResponse
  query: string
  page: number
  countryCode: string
}

/**
 * Same hydration approach as `SearchResults` (the /search results component):
 * the index stores a denormalised document with no `handle`, so hits are
 * re-hydrated into real Medusa products by id, restoring relevance order.
 */
const ResultsPanel = async ({
  search,
  query,
  page,
  countryCode,
}: ResultsPanelProps) => {
  const region = await getRegion(countryCode)
  if (!region) {
    return null
  }

  const productIds = search.results
    .map((hit) => String(hit.source.productId ?? hit.id))
    .filter(Boolean)

  let products: HttpTypes.StoreProduct[] = []

  if (productIds.length) {
    const {
      response: { products: fetched },
    } = await listProducts({
      countryCode,
      queryParams: {
        id: productIds,
        limit: productIds.length,
        fields: "*variants.calculated_price",
      },
    })

    const byId = new Map(fetched.map((p) => [p.id, p]))
    products = productIds
      .map((id) => byId.get(id))
      .filter((p): p is HttpTypes.StoreProduct => !!p)
  }

  const missing = search.results.length - products.length

  if (!products.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-24 gap-2 text-center">
        <Text className="text-large-semi text-ui-fg-base">No results found</Text>
        <Text className="text-base-regular text-ui-fg-subtle max-w-md">
          We couldn&apos;t find anything matching &ldquo;{query}&rdquo;. Try a
          different spelling, a broader term, or ask the assistant.
        </Text>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 w-full min-w-0">
      <ViewToggle
        resultCount={search.pagination.totalItems}
        missing={missing}
        query={query}
      >
        {products.map((product) => (
          <li key={product.id}>
            <ProductPreview product={product} region={region} />
          </li>
        ))}
      </ViewToggle>

      {search.pagination.totalPages > 1 && (
        <Pagination
          data-testid="search2-pagination"
          page={page}
          totalPages={search.pagination.totalPages}
        />
      )}
    </div>
  )
}

export default ResultsPanel
