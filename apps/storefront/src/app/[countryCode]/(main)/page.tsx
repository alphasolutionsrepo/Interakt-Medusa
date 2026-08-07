import { Metadata } from "next"

import { listCategories } from "@lib/data/categories"
import { listCollections } from "@lib/data/collections"
import { listProducts } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import CategoryTiles, {
  CategoryTile,
} from "@modules/home/components/category-tiles"
import FeaturedProducts from "@modules/home/components/featured-products"
import Hero from "@modules/home/components/hero"
import ProductRail from "@modules/home/components/featured-products/product-rail"

export const metadata: Metadata = {
  title: "Fashion Store",
  description:
    "Denim, knitwear and outerwear from twenty independent labels. Sizes XS through XXXL.",
}

/**
 * Departments shown as tiles, in display order. Deliberately explicit rather
 * than "every top-level category": the store also contains leftover starter
 * categories (Shirts, Sweatshirts, Pants, Merch) that should not appear here.
 */
const DEPARTMENTS = ["women", "men", "unisex", "kids"]

/**
 * How many brand collections get their own product rail. There are 20 brands,
 * and rendering a rail for each one meant 20 sequential backend requests and
 * ~240 product cards on the home page.
 */
const FEATURED_COLLECTION_COUNT = 3

export default async function Home(props: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await props.params

  const region = await getRegion(countryCode)

  if (!region) {
    return null
  }

  const [newArrivals, categories, { collections }] = await Promise.all([
    listProducts({
      regionId: region.id,
      // 4 for the hero collage + 6 for the "New arrivals" rail.
      queryParams: {
        limit: 10,
        order: "-created_at",
        fields: "*variants.calculated_price",
      },
    }).then(({ response }) => response),
    listCategories({
      limit: 100,
      fields: "id,name,handle,*category_children",
    }),
    listCollections({ fields: "id, handle, title" }),
  ])

  // One light query per department gives both a representative image and the
  // product count. Parent categories carry products directly, so this is a real
  // count rather than the sum of their children.
  const tileResults = await Promise.all(
    DEPARTMENTS.map(async (handle): Promise<CategoryTile | null> => {
      const category = categories?.find((c) => c.handle === handle)
      if (!category) {
        return null
      }

      const { products, count } = await listProducts({
        regionId: region.id,
        queryParams: { category_id: category.id, limit: 1, fields: "thumbnail" },
      }).then(({ response }) => response)

      return {
        category,
        image: products[0]?.thumbnail,
        count,
        children: category.category_children ?? [],
      }
    })
  )

  const tiles = tileResults.filter((tile): tile is CategoryTile => tile !== null)

  const featuredCollections = collections?.slice(0, FEATURED_COLLECTION_COUNT) ?? []

  return (
    <>
      <Hero
        products={newArrivals.products}
        productCount={newArrivals.count}
        brandCount={collections?.length}
      />

      <CategoryTiles tiles={tiles} />

      {newArrivals.products.length > 0 && (
        <div className="border-t border-ui-border-base">
          <ProductRail
            title="New arrivals"
            href="/store"
            products={newArrivals.products.slice(4)}
            region={region}
          />
        </div>
      )}

      {featuredCollections.length > 0 && (
        <div className="border-t border-ui-border-base">
          <ul className="flex flex-col gap-x-6">
            <FeaturedProducts collections={featuredCollections} region={region} />
          </ul>
        </div>
      )}
    </>
  )
}
