/**
 * Medusa product -> search document.
 *
 * Pure mapping code, shared by the reindex CLI and (later) the event-driven
 * workflow, so there is exactly one implementation of the contract.
 *
 * The receiving index applies a field-mapping DSL server-side, so this emits
 * RAW NESTED source documents. Do NOT add:
 *   - availableColors / availableSizes / fitTypes / minPrice / maxPrice /
 *     inStock / totalStockQuantity  -> `computed` from variants[] server-side
 *   - currency / language                                   -> `static`
 *   - uniqueId                                              -> `reference`
 *   - additionalData / customFields                          -> collectors
 *
 * `additionalData` is a `collect`-mode field that hoovers up unmapped keys, so
 * stray keys are not harmless: they land in a searchable field. Emit exactly
 * the keys below.
 *
 * The vector source is derived by the index, not sent from here — an
 * `embeddingtext` field was emitted for a while and has been removed.
 */

/** Fields required from `query.graph` to build a document. */
export const SEARCH_PRODUCT_FIELDS = [
  "id",
  "external_id",
  "title",
  "subtitle",
  "description",
  "handle",
  "material",
  "thumbnail",
  "status",
  "created_at",
  "updated_at",
  "metadata",
  "images.url",
  "images.rank",
  "type.value",
  "collection.title",
  "categories.id",
  "categories.name",
  "categories.parent_category_id",
  "categories.parent_category.name",
  "tags.value",
  "variants.id",
  "variants.title",
  "variants.sku",
  "variants.barcode",
  "variants.manage_inventory",
  "variants.metadata",
  "variants.options.value",
  "variants.options.option.title",
  "variants.calculated_price.calculated_amount",
  "variants.calculated_price.original_amount",
  "variants.calculated_price.currency_code",
]

export const SIZE_OPTION = "Size"
export const COLOR_OPTION = "Color"

/**
 * Tag prefixes the importer adds to dodge a case-insensitive collision with
 * catalogue tags on Medusa's side. They must not reach the index: style,
 * season, gender and ageGroup are separate first-class facets with proper
 * display casing, so leaking these would double-count and expose
 * handle-cased duplicates.
 */
const NAMESPACED_TAG = /^(style|season|gender|age):/

export interface SearchVariant {
  sku: string | null
  barcode: string | null
  size: string | null
  color: string | null
  colorHex: string | null
  fit: string | null
  sizeSystem: string | null
  price: number | null
  originalPrice: number | null
  isDefaultVariant: boolean
  stockQuantity: number
  inStock: boolean
}

export interface SearchDocument {
  productId: string
  externalId: string | null
  name: string
  shortDescription: string | null
  longDescription: string | null
  brand: string | null
  category: string | null
  subCategory: string | null
  gender: string | null
  ageGroup: string | null
  season: string | null
  style: string | null
  material: string | null
  primaryColor: string | null
  careInstructions: string | null
  tags: string[]
  rating: number | null
  ratingCount: number | null
  hasDiscount: boolean | null
  primaryImageUrl: string | null
  additionalImageUrls: string[]
  createdAt: string | null
  updatedAt: string | null
  variants: SearchVariant[]
}

/** Problems worth surfacing without dropping the document. */
export interface DocumentWarning {
  productId: string
  field: string
  detail: string
}

/* ------------------------------------------------------------------ helpers */

type Meta = Record<string, unknown> | null | undefined

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const bool = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v
  if (v === "true") return true
  if (v === "false") return false
  return null
}

const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** `business-casual` -> `Business Casual`, to repair handle-cased tag values. */
const titleCase = (s: string): string =>
  s
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ")

/* ----------------------------------------------------------------- mapping */

interface GraphCategory {
  id?: string
  name?: string
  parent_category_id?: string | null
  parent_category?: { name?: string } | null
}

interface GraphOptionValue {
  value?: string
  option?: { title?: string } | null
}

interface GraphVariant {
  id: string
  title?: string
  sku?: string | null
  barcode?: string | null
  manage_inventory?: boolean
  metadata?: Meta
  options?: GraphOptionValue[] | null
  calculated_price?: {
    calculated_amount?: number | null
    original_amount?: number | null
    currency_code?: string | null
  } | null
}

export interface GraphProduct {
  id: string
  external_id?: string | null
  title?: string
  subtitle?: string | null
  description?: string | null
  handle?: string | null
  material?: string | null
  thumbnail?: string | null
  status?: string
  created_at?: string | Date
  updated_at?: string | Date
  metadata?: Meta
  images?: { url?: string; rank?: number }[] | null
  type?: { value?: string } | null
  collection?: { title?: string } | null
  categories?: GraphCategory[] | null
  tags?: { value?: string }[] | null
  variants?: GraphVariant[] | null
}

/** Availability keyed by variant id, as returned by `getTotalVariantAvailability`. */
export type AvailabilityMap = Record<string, { availability?: number | null }>

/**
 * The child category is the one WITH a parent. Building from it (rather than
 * cross-referencing the two linked categories) stays correct for products
 * linked to only one category and for deeper trees. Uses `name`, never
 * `handle` — the importer namespaces only the handle (`men-jackets`).
 */
function buildCategory(product: GraphProduct): {
  category: string | null
  parentName: string | null
} {
  const cats = product.categories ?? []
  const child = cats.find((c) => c.parent_category_id)
  const parentName = str(child?.parent_category?.name)

  if (child && parentName) {
    return { category: `${parentName} > ${child.name}`, parentName }
  }
  if (child?.name) {
    return { category: child.name, parentName: null }
  }
  return { category: str(cats[0]?.name), parentName: null }
}

function tagValue(product: GraphProduct, namespace: string): string | null {
  const hit = (product.tags ?? []).find((t) =>
    t.value?.startsWith(`${namespace}:`)
  )
  const raw = hit?.value?.slice(namespace.length + 1)
  return raw ? titleCase(raw) : null
}

function optionValue(variant: GraphVariant, title: string): string | null {
  // From the option VALUES, never from splitting variant.title on " / " —
  // a value containing a slash would break that.
  return (
    str(variant.options?.find((o) => o.option?.title === title)?.value) ?? null
  )
}

export function toSearchDocument(
  product: GraphProduct,
  availability: AvailabilityMap = {},
  warnings: DocumentWarning[] = []
): SearchDocument {
  const meta = (product.metadata ?? {}) as Record<string, unknown>
  const { category, parentName } = buildCategory(product)
  const images = (product.images ?? [])
    .map((i) => str(i.url))
    .filter((u): u is string => !!u)

  const warn = (field: string, detail: string) =>
    warnings.push({ productId: product.id, field, detail })

  // Medusa auto-derives `thumbnail` from images[0], so the primary must be
  // excluded by VALUE rather than by index, or it appears twice.
  const primaryImageUrl = str(product.thumbnail) ?? images[0] ?? null
  const additionalImageUrls = images.filter((u) => u !== primaryImageUrl)

  // A live Medusa field wins wherever one exists; metadata is a snapshot the
  // importer wrote once and goes stale when an admin re-files a product.
  const brand = str(product.collection?.title) ?? str(meta.brand)
  const subCategory = str(product.type?.value) ?? str(meta.subCategory)

  // gender falls back to the parent category, which IS the gender in this data
  // model and is always present and live. It carries the index's highest boost.
  const gender = str(meta.gender) ?? parentName ?? tagValue(product, "gender")
  const style = str(meta.style) ?? tagValue(product, "style")
  const season = str(meta.season) ?? tagValue(product, "season")
  const ageGroup = str(meta.ageGroup) ?? tagValue(product, "age")

  if (!category) warn("category", "no category linked")
  if (!brand) warn("brand", "no collection and no metadata.brand")
  if (!gender) warn("gender", "no metadata, parent category or gender: tag")
  if (!images.length) warn("primaryImageUrl", "no images")

  const variants = (product.variants ?? []).map<SearchVariant>((v) => {
    const vMeta = (v.metadata ?? {}) as Record<string, unknown>
    const price = num(v.calculated_price?.calculated_amount)
    const stock = num(availability[v.id]?.availability) ?? 0

    if (price === null) {
      warn("variants.price", `variant ${v.sku ?? v.id} has no USD price`)
    }

    return {
      sku: str(v.sku),
      barcode: str(v.barcode),
      size: optionValue(v, SIZE_OPTION),
      color: optionValue(v, COLOR_OPTION),
      colorHex: str(vMeta.colorHex),
      fit: str(vMeta.fit),
      sizeSystem: str(vMeta.sizeSystem),
      price,
      // The source RRP. calculated_price.original_amount is NOT this — it
      // equals calculated_amount unless a price list applies.
      originalPrice: num(vMeta.originalPrice),
      isDefaultVariant: bool(vMeta.isDefaultVariant) ?? false,
      stockQuantity: stock,
      inStock: stock > 0,
    }
  })

  return {
    productId: product.id,
    externalId: str(product.external_id),
    name: product.title ?? "",
    shortDescription: str(product.subtitle),
    longDescription: str(product.description),
    brand,
    category,
    subCategory,
    gender,
    ageGroup,
    season,
    style,
    material: str(product.material),
    primaryColor: str(meta.primaryColor),
    careInstructions: str(meta.careInstructions),
    tags: (product.tags ?? [])
      .map((t) => t.value)
      .filter((v): v is string => !!v && !NAMESPACED_TAG.test(v))
      .sort(),
    rating: num(meta.rating),
    ratingCount: num(meta.ratingCount),
    hasDiscount: bool(meta.hasDiscount),
    primaryImageUrl,
    additionalImageUrls,
    createdAt: iso(product.created_at),
    updatedAt: iso(product.updated_at),
    variants,
  }
}
