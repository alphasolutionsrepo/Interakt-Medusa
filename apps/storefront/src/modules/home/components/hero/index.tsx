import { isSearchEnabled } from "@lib/util/search-config"
import { ArrowRight } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import { Heading, Text } from "@modules/common/components/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import SearchBox from "@modules/search/components/search-box"
import Image from "next/image"

type HeroProps = {
  /** Products whose imagery fills the collage. The first four are used. */
  products?: HttpTypes.StoreProduct[]
  /** Shown as a small proof line under the buttons. */
  productCount?: number
  brandCount?: number
}

/**
 * Catalog imagery is square, product-on-white studio shots — so a full-bleed
 * photo with text laid over it reads badly. Instead the copy sits on a tinted
 * panel next to the products, which keeps the white cut-outs looking deliberate.
 */
const Hero = ({ products = [], productCount, brandCount }: HeroProps) => {
  // A 2x2 grid of squares: the source images are 1:1, so any other cell shape
  // leaves the contained image floating in dead space.
  const collage = products.slice(0, 4)

  return (
    <div className="w-full border-b border-ui-border-base bg-gradient-to-br from-[#f6f1ea] via-[#f3f4f6] to-[#eef1f6]">
      <div className="content-container py-16 small:py-24">
        <div className="grid grid-cols-1 small:grid-cols-12 gap-10 small:gap-16 items-center">
          {/* Copy */}
          <div className="small:col-span-5 flex flex-col gap-6">
            <span className="text-xsmall-regular uppercase tracking-[0.2em] text-ui-fg-muted">
              New season · 2026
            </span>

            <Heading
              level="h1"
              className="text-4xl small:text-5xl leading-[1.1] tracking-tight text-ui-fg-base"
            >
              Wardrobe staples,
              <br />
              built to be worn.
            </Heading>

            <Text className="text-ui-fg-subtle max-w-md">
              Denim, knitwear and outerwear from twenty independent labels.
              Considered fabrics, honest prices, sizes XS through XXXL.
            </Text>

            {isSearchEnabled() && (
              <div className="max-w-md pt-2">
                <SearchBox data-testid="hero-search-input" />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <LocalizedClientLink
                href="/categories/women"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-black px-6 text-white transition-colors hover:bg-gray-800"
              >
                Shop women
                <ArrowRight />
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/categories/men"
                className="inline-flex h-12 items-center gap-2 rounded-full border border-ui-border-base bg-white px-6 text-ui-fg-base transition-colors hover:bg-gray-50"
              >
                Shop men
              </LocalizedClientLink>
            </div>

            {(productCount || brandCount) && (
              <Text className="text-small-regular text-ui-fg-muted pt-2">
                {[
                  productCount ? `${productCount}+ styles` : null,
                  brandCount ? `${brandCount} brands` : null,
                  "Free returns within 30 days",
                ]
                  .filter(Boolean)
                  .join("  ·  ")}
              </Text>
            )}

            {isSearchEnabled() && (
              <Text className="text-xsmall-regular text-ui-fg-muted">
                Powered by Interakt - AI-Powered Search & Chat
              </Text>
            )}
          </div>

          {/* Product collage */}
          {collage.length > 0 && (
            <div className="small:col-span-7">
              {/* Capped so two rows of squares don't turn the banner into a
                  900px-tall wall that pushes the copy off screen. */}
              <div className="mx-auto grid w-full max-w-[520px] grid-cols-2 gap-4 small:ml-auto small:mr-0 small:gap-5">
                {collage.map((product, i) => (
                  <HeroCard key={product.id} product={product} priority={i === 0} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const HeroCard = ({
  product,
  priority,
}: {
  product: HttpTypes.StoreProduct
  priority?: boolean
}) => {
  const image = product.thumbnail ?? product.images?.[0]?.url

  if (!image) {
    return null
  }

  return (
    <LocalizedClientLink
      href={`/products/${product.handle}`}
      className="group relative block aspect-square overflow-hidden rounded-large bg-white shadow-elevation-card-rest transition-shadow duration-150 ease-in-out hover:shadow-elevation-card-hover"
    >
      <Image
        src={image}
        alt={product.title ?? "Product"}
        fill
        priority={priority}
        // object-contain: these are cut-outs on white, cropping them looks
        // broken. Extra bottom padding keeps the art clear of the caption.
        className="object-contain p-4 pb-9 transition-transform duration-300 ease-out group-hover:scale-[1.03]"
        sizes="(max-width: 1024px) 50vw, 260px"
      />
      <span className="absolute inset-x-4 bottom-3 truncate text-xsmall-regular text-ui-fg-muted">
        {product.title}
      </span>
    </LocalizedClientLink>
  )
}

export default Hero
