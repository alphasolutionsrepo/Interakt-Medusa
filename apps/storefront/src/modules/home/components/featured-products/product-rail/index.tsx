import { listProducts } from "@lib/data/products"
import { HttpTypes } from "@medusajs/types"
import { Heading } from "@modules/common/components/ui"

import InteractiveLink from "@modules/common/components/interactive-link"
import ProductPreview from "@modules/products/components/product-preview"

type ProductRailProps = {
  region: HttpTypes.StoreRegion
  /** Fetch and render a collection's products. */
  collection?: HttpTypes.StoreCollection
  /** Or render products that were already fetched. */
  products?: HttpTypes.StoreProduct[]
  title?: string
  href?: string
}

/**
 * A titled row of products. Either point it at a collection and it fetches, or
 * hand it products you already have (avoids a second round trip when the caller
 * fetched them anyway).
 */
export default async function ProductRail({
  collection,
  region,
  products,
  title,
  href,
}: ProductRailProps) {
  let railProducts = products

  if (!railProducts && collection) {
    const {
      response: { products: fetched },
    } = await listProducts({
      regionId: region.id,
      queryParams: {
        collection_id: collection.id,
        fields: "*variants.calculated_price",
      },
    })
    railProducts = fetched
  }

  if (!railProducts?.length) {
    return null
  }

  const railTitle = title ?? collection?.title
  const railHref = href ?? (collection ? `/collections/${collection.handle}` : undefined)

  return (
    <div className="content-container py-12 small:py-24">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <Heading level="h2" className="text-2xl tracking-tight">
          {railTitle}
        </Heading>
        {railHref && <InteractiveLink href={railHref}>View all</InteractiveLink>}
      </div>
      <ul className="grid grid-cols-2 small:grid-cols-3 gap-x-6 gap-y-12 small:gap-y-16">
        {railProducts.map((product) => (
          <li key={product.id}>
            <ProductPreview product={product} region={region} isFeatured />
          </li>
        ))}
      </ul>
    </div>
  )
}
