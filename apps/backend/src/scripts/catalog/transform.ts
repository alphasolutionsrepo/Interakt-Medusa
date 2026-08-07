import path from "path"
import { CreateProductWorkflowInputDTO, Logger } from "@medusajs/framework/types"
import { ProductStatus, toHandle } from "@medusajs/framework/utils"
import { COLOR_OPTION, SIZE_OPTION, SharedOptions } from "./options"
import { StoreContext } from "./store-setup"
import { Taxonomy, childHandleOf, parentHandleOf, tagValuesOf } from "./taxonomy"
import { CatalogProduct } from "./types"
import { must } from "./util"

/**
 * Where product images are served from.
 *
 * The backend static-serves `apps/backend/static/` at `/static`, so this covers
 * both consumers: the admin (same origin, plain <img>) and the storefront
 * (next.config.js already whitelists http://localhost and sets
 * images.unoptimized). A relative "/images/x.jpg" would render in the
 * storefront but give 199 broken thumbnails in the admin.
 */
export const IMAGE_BASE =
  process.env.IMPORT_IMAGE_BASE_URL ?? "http://localhost:9000/static/catalog"

/**
 * The catalog is USD-only. Flip this to also write a 1:1 EUR price so the
 * pre-existing Europe region (/dk, /de, ...) shows prices too — pricing filters
 * hard on currency_code with no fallback, so USD-only means those routes render
 * products with no price at all.
 */
export const ALSO_PRICE_IN_EUR = false

export interface TransformStats {
  handlesSuffixed: number
  skusRewritten: number
  imagesAttached: number
  imagesSkipped: number
}

export interface Transformer {
  toProductInput: (p: CatalogProduct) => CreateProductWorkflowInputDTO
  handleOf: (p: CatalogProduct) => string
  /** Final SKU -> stock quantity, used to set inventory levels. */
  stockBySku: Map<string, number>
  stats: TransformStats
}

/**
 * Assign a unique handle to every product, deterministically.
 *
 * `product.handle` is unique. 4 catalog names repeat (one 3x), so those get a
 * productId suffix. The taken-set is seeded from the DB as well as the file so
 * a resumed run does not collide with what it already inserted.
 */
function buildHandles(
  products: CatalogProduct[],
  existingHandles: Set<string>,
  stats: TransformStats
): Map<string, string> {
  const baseCounts = new Map<string, number>()
  for (const p of products) {
    const base = toHandle(p.name)
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1)
  }

  const taken = new Set(existingHandles)
  const out = new Map<string, string>()

  for (const p of products) {
    const base = toHandle(p.name)
    const suffix = p.productId.replace(/^PROD-/, "")

    let handle = base
    if ((baseCounts.get(base) ?? 0) > 1 || taken.has(base)) {
      handle = `${base}-${suffix}`
      stats.handlesSuffixed++
    }
    while (taken.has(handle)) {
      handle = `${handle}-${suffix}`
    }

    taken.add(handle)
    out.set(p.productId, handle)
  }

  return out
}

/**
 * Resolve SKU collisions.
 *
 * Both `product_variant.sku` and `inventory_item.sku` are unique, so a
 * duplicate fails twice. PROD-0070 collides because "Burgundy" and
 * "Burnt Orange" both slug to "BUR" upstream. Handled generically rather than
 * as a special case, since the source may drift; the original is preserved in
 * variant metadata as `source_sku`.
 */
function buildSkus(
  products: CatalogProduct[],
  existingSkus: Set<string>,
  logger: Logger,
  stats: TransformStats
): Map<string, string[]> {
  const seen = new Set(existingSkus)
  const out = new Map<string, string[]>()

  for (const p of products) {
    const resolved = p.variants.map((v) => {
      if (!seen.has(v.sku)) {
        seen.add(v.sku)
        return v.sku
      }
      for (let n = 2; ; n++) {
        const candidate = `${v.sku}-${n}`
        if (!seen.has(candidate)) {
          seen.add(candidate)
          logger.warn(`sku collision: ${v.sku} -> ${candidate} (${p.productId})`)
          stats.skusRewritten++
          return candidate
        }
      }
    })

    out.set(p.productId, resolved)
  }

  return out
}

/**
 * Product images.
 *
 * Only `primaryImageUrl` is real; every `additionalImageUrls` and
 * `variantImageUrl` value is a fake example.com URL and is discarded. PROD-0082
 * has no generated image, so it gets none — leaving `thumbnail` null makes the
 * storefront render its real placeholder, whereas a dead URL would show the
 * browser's broken-image glyph (images.unoptimized bypasses Next's loader).
 */
function imagesFor(p: CatalogProduct, stats: TransformStats): { url: string }[] {
  if (p.imageGenerationError || !p.primaryImageUrl?.startsWith("/images/")) {
    stats.imagesSkipped++
    return []
  }

  stats.imagesAttached++
  return [{ url: `${IMAGE_BASE}/${path.basename(p.primaryImageUrl)}` }]
}

export function createTransformer(opts: {
  products: CatalogProduct[]
  taxonomy: Taxonomy
  options: SharedOptions
  store: StoreContext
  existingHandles: Set<string>
  existingSkus: Set<string>
  logger: Logger
}): Transformer {
  const { products, taxonomy, options, store, logger } = opts

  const stats: TransformStats = {
    handlesSuffixed: 0,
    skusRewritten: 0,
    imagesAttached: 0,
    imagesSkipped: 0,
  }

  const handles = buildHandles(products, opts.existingHandles, stats)
  const skus = buildSkus(products, opts.existingSkus, logger, stats)
  const stockBySku = new Map<string, number>()

  const sizeOption = must(options.get(SIZE_OPTION), `shared option "${SIZE_OPTION}" not found`)
  const colorOption = must(options.get(COLOR_OPTION), `shared option "${COLOR_OPTION}" not found`)

  const handleOf = (p: CatalogProduct) =>
    must(handles.get(p.productId), `no handle computed for ${p.productId}`)

  const toProductInput = (p: CatalogProduct): CreateProductWorkflowInputDTO => {
    const resolvedSkus = must(skus.get(p.productId), `no skus computed for ${p.productId}`)

    // Distinct option values this product uses, in canonical rank order, so the
    // PDP selectors read XS -> XXXL rather than source order.
    const byRank = (opt: typeof sizeOption) => (a: string, b: string) =>
      (opt.rankByValue.get(a) ?? 0) - (opt.rankByValue.get(b) ?? 0)

    const sizes = [...new Set(p.variants.map((v) => v.size))].sort(byRank(sizeOption))
    const colors = [...new Set(p.variants.map((v) => v.color))].sort(byRank(colorOption))

    // Sort variants colour-then-size: nothing orders variants on read, so
    // insertion order is what admin and the PDP display.
    const ordered = p.variants
      .map((v, i) => ({ v, sku: resolvedSkus[i] }))
      .sort(
        (a, b) =>
          (colorOption.rankByValue.get(a.v.color) ?? 0) -
            (colorOption.rankByValue.get(b.v.color) ?? 0) ||
          (sizeOption.rankByValue.get(a.v.size) ?? 0) -
            (sizeOption.rankByValue.get(b.v.size) ?? 0)
      )

    for (const { v, sku } of ordered) {
      stockBySku.set(sku, v.stockQuantity)
    }

    return {
      title: p.name,
      subtitle: p.shortDescription,
      description: p.longDescription,
      handle: handleOf(p),
      // Without PUBLISHED the store API hides it: the default is DRAFT.
      status: ProductStatus.PUBLISHED,
      // The idempotency key for re-runs.
      external_id: p.productId,
      material: p.material,
      images: imagesFor(p, stats),
      type_id: must(taxonomy.types.get(p.subCategory), `no type for "${p.subCategory}"`),
      collection_id: must(
        taxonomy.collections.get(toHandle(p.brand)),
        `no collection for brand "${p.brand}"`
      ),
      // BOTH parent and child: category filtering is direct membership only, so
      // linking just the child leaves /categories/men showing zero products.
      category_ids: [
        must(taxonomy.categories.get(parentHandleOf(p)), `no parent category for ${p.productId}`),
        must(taxonomy.categories.get(childHandleOf(p)), `no child category for ${p.productId}`),
      ],
      tag_ids: tagValuesOf(p).map((t) => must(taxonomy.tags.get(t), `no tag for "${t}"`)),
      // Required at cart completion, else Place Order throws.
      shipping_profile_id: store.shippingProfileId,
      // Required or every product detail page 404s.
      sales_channels: [{ id: store.salesChannelId }],
      options: [
        {
          id: sizeOption.id,
          value_ids: sizes.map((s) =>
            must(sizeOption.valueIdByValue.get(s), `size value "${s}" not registered`)
          ),
        },
        {
          id: colorOption.id,
          value_ids: colors.map((c) =>
            must(colorOption.valueIdByValue.get(c), `color value "${c}" not registered`)
          ),
        },
      ],
      variants: ordered.map(({ v, sku }) => ({
        title: `${v.size} / ${v.color}`,
        sku,
        barcode: v.barcode,
        manage_inventory: true,
        // Keyed by option TITLE; every variant must supply a value for every option.
        options: { [SIZE_OPTION]: v.size, [COLOR_OPTION]: v.color },
        prices: [
          { currency_code: "usd", amount: v.price },
          ...(ALSO_PRICE_IN_EUR ? [{ currency_code: "eur", amount: v.price }] : []),
        ],
        metadata: {
          colorHex: v.colorHex,
          fit: v.fit,
          sizeSystem: v.sizeSystem,
          originalPrice: v.originalPrice,
          isDefaultVariant: v.isDefaultVariant,
          source_sku: v.sku,
        },
      })),
      metadata: {
        source: "fashion_catalog",
        productId: p.productId,
        brand: p.brand,
        subCategory: p.subCategory,
        gender: p.gender,
        ageGroup: p.ageGroup,
        season: p.season,
        style: p.style,
        primaryColor: p.primaryColor,
        careInstructions: p.careInstructions,
        rating: p.rating,
        ratingCount: p.ratingCount,
        hasDiscount: p.hasDiscount,
        sourceCreatedAt: p.createdAt,
        sourceUpdatedAt: p.updatedAt,
      },
    }
  }

  return { toProductInput, handleOf, stockBySku, stats }
}
