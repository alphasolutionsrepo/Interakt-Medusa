import { HttpTypes } from "@medusajs/types"
import { Heading, Text } from "@modules/common/components/ui"
import InteractiveLink from "@modules/common/components/interactive-link"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Image from "next/image"

export type CategoryTile = {
  category: HttpTypes.StoreProductCategory
  /** A representative product image for the tile. */
  image?: string | null
  /** Number of products directly in the category. */
  count?: number
  /** A few child category names, shown as quick links. */
  children?: HttpTypes.StoreProductCategory[]
}

/**
 * Top-level shopping entry points (Men / Women / Unisex / Kids).
 *
 * Each parent category is linked directly — the import puts products on both
 * the parent and the child category, so /categories/men is a real listing page
 * rather than an empty shell.
 */
const CategoryTiles = ({ tiles }: { tiles: CategoryTile[] }) => {
  if (!tiles.length) {
    return null
  }

  return (
    <section className="content-container py-16 small:py-24">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-xsmall-regular uppercase tracking-[0.2em] text-ui-fg-muted">
            Shop by department
          </span>
          <Heading level="h2" className="text-2xl small:text-3xl tracking-tight">
            Find your fit
          </Heading>
        </div>
        <InteractiveLink href="/store">Browse everything</InteractiveLink>
      </div>

      <ul className="grid grid-cols-2 gap-4 small:grid-cols-4 small:gap-6">
        {tiles.map(({ category, image, count, children }) => (
          <li key={category.id}>
            <LocalizedClientLink
              href={`/categories/${category.handle}`}
              className="group flex h-full flex-col overflow-hidden rounded-large border border-ui-border-base bg-ui-bg-subtle transition-shadow duration-150 ease-in-out hover:shadow-elevation-card-hover"
            >
              <div className="relative aspect-square w-full overflow-hidden bg-white">
                {image ? (
                  <Image
                    src={image}
                    alt={category.name}
                    fill
                    className="object-contain p-5 transition-transform duration-300 ease-out group-hover:scale-105"
                    sizes="(max-width: 1024px) 50vw, 25vw"
                  />
                ) : (
                  <div className="absolute inset-0 bg-ui-bg-subtle" />
                )}
              </div>

              <div className="flex flex-1 flex-col gap-1 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <Text className="font-medium text-ui-fg-base">
                    {category.name}
                  </Text>
                  {!!count && (
                    <Text className="text-xsmall-regular text-ui-fg-muted">
                      {count}
                    </Text>
                  )}
                </div>
                {!!children?.length && (
                  <Text className="text-small-regular text-ui-fg-subtle line-clamp-2">
                    {children
                      .slice(0, 3)
                      .map((c) => c.name)
                      .join(", ")}
                  </Text>
                )}
              </div>
            </LocalizedClientLink>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default CategoryTiles
