import { listProducts } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import { SearchResponse } from "@lib/interakt/types"
import { HttpTypes } from "@medusajs/types"
import { Text } from "@modules/common/components/ui"
import ProductPreview from "@modules/products/components/product-preview"
import { Pagination } from "@modules/store/components/pagination"

type SearchResultsProps = {
  search: SearchResponse
  query: string
  page: number
  countryCode: string
}

/**
 * Render search hits as real product cards.
 *
 * The index stores a denormalised document, not a Medusa product — and notably
 * no `handle`, so a hit cannot be linked to on its own. Hydrating by id fixes
 * that and buys live prices, the existing card/thumbnail/pagination components
 * unchanged, and no new image hosts in next.config.js.
 */
const SearchResults = async ({
  search,
  query,
  page,
  countryCode,
}: SearchResultsProps) => {
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
        // Must be explicit: the default is 12, and `listProductsWithSort` would
        // over-fetch 100 rows to sort in memory. Neither is wanted here.
        limit: productIds.length,
        fields: "*variants.calculated_price",
      },
    })

    // `id: [...]` returns rows in database order, which throws away the
    // relevance ranking that is the entire point of searching. Restore it.
    const byId = new Map(fetched.map((p) => [p.id, p]))
    products = productIds
      .map((id) => byId.get(id))
      .filter((p): p is HttpTypes.StoreProduct => !!p)
  }

  /**
   * Report what actually rendered, not the index's total. A document can
   * outlive its product — the sync subscribers make that rare, but claiming
   * "24 results" above 23 cards is a bug users notice.
   */
  const missing = search.results.length - products.length

  if (!products.length) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-2 text-center">
        <Text className="text-large-semi text-ui-fg-base">No results found</Text>
        <Text className="text-base-regular text-ui-fg-subtle max-w-md">
          We couldn&apos;t find anything matching &ldquo;{query}&rdquo;. Try a
          different spelling, a broader term, or clear your filters.
        </Text>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8 w-full">
      <Text className="text-base-regular text-ui-fg-subtle">
        {search.pagination.totalItems.toLocaleString()}{" "}
        {search.pagination.totalItems === 1 ? "result" : "results"} for{" "}
        <span className="text-ui-fg-base">&ldquo;{query}&rdquo;</span>
        {missing > 0 && (
          <span className="text-ui-fg-muted">
            {" "}
            ({missing} no longer available)
          </span>
        )}
      </Text>

      <ul
        className="grid grid-cols-2 w-full small:grid-cols-3 medium:grid-cols-4 gap-x-6 gap-y-8"
        data-testid="search-results-list"
      >
        {products.map((product) => (
          <li key={product.id}>
            <ProductPreview product={product} region={region} />
          </li>
        ))}
      </ul>

      {search.pagination.totalPages > 1 && (
        <Pagination
          data-testid="search-pagination"
          page={page}
          totalPages={search.pagination.totalPages}
        />
      )}
    </div>
  )
}

export default SearchResults
