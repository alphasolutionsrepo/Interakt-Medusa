import { MedusaContainer } from "@medusajs/framework"
import { Logger } from "@medusajs/framework/types"
import { toHandle } from "@medusajs/framework/utils"
import {
  createCollectionsWorkflow,
  createProductCategoriesWorkflow,
  createProductTagsWorkflow,
  createProductTypesWorkflow,
} from "@medusajs/medusa/core-flows"
import { CatalogProduct } from "./types"
import { pagedGraph, unique } from "./util"

/**
 * Product create only accepts ids (`category_ids`, `type_id`, `collection_id`,
 * `tag_ids`) — there is no upsert-by-value, and an unknown tag id throws. So
 * every taxonomy entity is created up front and reduced to a natural-key -> id
 * map.
 */
export interface Taxonomy {
  /** handle -> id, for both parents ("men") and children ("men-jackets"). */
  categories: Map<string, string>
  /** subCategory value -> product type id. */
  types: Map<string, string>
  /** brand handle -> collection id. */
  collections: Map<string, string>
  /** tag value -> tag id. */
  tags: Map<string, string>
}

export function parentHandleOf(p: CatalogProduct): string {
  return toHandle(p.category.split(" > ")[0])
}

/**
 * Child category handles are namespaced with their parent because
 * `product_category.handle` is unique GLOBALLY — "Men > Jackets" and
 * "Women > Jackets" would both want "jackets".
 */
export function childHandleOf(p: CatalogProduct): string {
  const [parent, child] = p.category.split(" > ")
  return `${toHandle(parent)}-${toHandle(child)}`
}

/**
 * Tag values for a product.
 *
 * Catalog tags are already lowercase and are used verbatim. The other four
 * dimensions are prefixed because they collide case-insensitively with catalog
 * tags (style "Casual" vs tag "casual", season "Winter" vs tag "winter") and
 * `product_tag.value` is only case-SENSITIVELY unique — both would insert and
 * be indistinguishable in the facet.
 */
export function tagValuesOf(p: CatalogProduct): string[] {
  return unique([
    ...p.tags,
    `style:${toHandle(p.style)}`,
    `season:${toHandle(p.season)}`,
    `gender:${toHandle(p.gender)}`,
    `age:${toHandle(p.ageGroup)}`,
  ])
}

/** The natural keys the catalog needs, per entity. Computed without any DB access. */
export interface TaxonomyPlan {
  entity: string
  label: string
  keyField: string
  keys: string[]
}

/**
 * What the catalog requires, derived from the file alone — used by the dry run
 * to report needed-vs-existing without writing anything.
 */
export function describeTaxonomy(products: CatalogProduct[]): TaxonomyPlan[] {
  const parents = unique(products.map((p) => toHandle(p.category.split(" > ")[0])))
  const children = unique(products.map(childHandleOf))

  return [
    {
      entity: "product_category",
      label: "categories",
      keyField: "handle",
      keys: [...parents, ...children],
    },
    {
      entity: "product_type",
      label: "product types",
      keyField: "value",
      keys: unique(products.map((p) => p.subCategory)),
    },
    {
      entity: "product_collection",
      label: "collections (brands)",
      keyField: "handle",
      keys: unique(products.map((p) => toHandle(p.brand))),
    },
    {
      entity: "product_tag",
      label: "tags",
      keyField: "value",
      keys: unique(products.flatMap(tagValuesOf)),
    },
  ]
}

/**
 * Read every existing row, create only what is missing, return key -> id.
 * This is what makes the whole taxonomy phase re-runnable.
 */
async function ensureByKey<TWanted extends Record<string, unknown>>(opts: {
  container: MedusaContainer
  logger: Logger
  label: string
  entity: string
  keyField: string
  wanted: TWanted[]
  create: (missing: TWanted[]) => Promise<void>
}): Promise<Map<string, string>> {
  const { container, logger, label, entity, keyField, wanted, create } = opts

  const existing = await pagedGraph<Record<string, string>>(container, {
    entity,
    fields: ["id", keyField],
  })
  const byKey = new Map(existing.map((e) => [e[keyField], e.id]))

  const missing = wanted.filter((w) => !byKey.has(w[keyField] as string))
  if (missing.length) {
    await create(missing)
    const refreshed = await pagedGraph<Record<string, string>>(container, {
      entity,
      fields: ["id", keyField],
    })
    byKey.clear()
    refreshed.forEach((e) => byKey.set(e[keyField], e.id))
  }

  logger.info(`${label}: ${wanted.length} needed, ${missing.length} created, ${byKey.size} total`)
  return byKey
}

export async function ensureTaxonomy(
  container: MedusaContainer,
  logger: Logger,
  products: CatalogProduct[]
): Promise<Taxonomy> {
  // --- Categories: parents first, then children referencing them -----------
  const parentNames = unique(products.map((p) => p.category.split(" > ")[0]))

  const categories = await ensureByKey({
    container,
    logger,
    label: "categories (parents)",
    entity: "product_category",
    keyField: "handle",
    wanted: parentNames.map((name) => ({ name, handle: toHandle(name) })),
    create: async (missing) => {
      await createProductCategoriesWorkflow(container).run({
        input: {
          product_categories: missing.map((c, i) => ({
            name: c.name,
            handle: c.handle,
            is_active: true,
            rank: i,
            metadata: { source: "fashion_catalog", level: "gender" },
          })),
        },
      })
    },
  })

  const childSpecs = unique(products.map((p) => p.category))
    .map((category) => {
      const [parent, child] = category.split(" > ")
      return {
        name: child,
        handle: `${toHandle(parent)}-${toHandle(child)}`,
        parentHandle: toHandle(parent),
      }
    })
    .sort((a, b) => a.handle.localeCompare(b.handle))

  const withChildren = await ensureByKey({
    container,
    logger,
    label: "categories (children)",
    entity: "product_category",
    keyField: "handle",
    wanted: childSpecs,
    create: async (missing) => {
      await createProductCategoriesWorkflow(container).run({
        input: {
          product_categories: missing.map((c, i) => ({
            name: c.name,
            handle: c.handle,
            parent_category_id: categories.get(c.parentHandle),
            is_active: true,
            rank: i,
            metadata: { source: "fashion_catalog", level: "category" },
          })),
        },
      })
    },
  })

  // --- Product types (one per subCategory) ---------------------------------
  const types = await ensureByKey({
    container,
    logger,
    label: "product types",
    entity: "product_type",
    keyField: "value",
    wanted: unique(products.map((p) => p.subCategory)).map((value) => ({ value })),
    create: async (missing) => {
      await createProductTypesWorkflow(container).run({
        input: {
          product_types: missing.map((t) => ({
            value: t.value,
            metadata: { source: "fashion_catalog" },
          })),
        },
      })
    },
  })

  // --- Collections (one per brand) ----------------------------------------
  // An explicit handle is required: collection auto-handles use kebabCase,
  // which does not strip "&", so "Haven & Hart" would become "haven-&-hart".
  const brands = unique(products.map((p) => p.brand))
  const collections = await ensureByKey({
    container,
    logger,
    label: "collections (brands)",
    entity: "product_collection",
    keyField: "handle",
    wanted: brands.map((title) => ({ title, handle: toHandle(title) })),
    create: async (missing) => {
      await createCollectionsWorkflow(container).run({
        input: {
          collections: missing.map((c) => ({
            title: c.title,
            handle: c.handle,
            metadata: { source: "fashion_catalog", kind: "brand" },
          })),
        },
      })
    },
  })

  // --- Tags ---------------------------------------------------------------
  const tags = await ensureByKey({
    container,
    logger,
    label: "tags",
    entity: "product_tag",
    keyField: "value",
    wanted: unique(products.flatMap(tagValuesOf)).map((value) => ({ value })),
    create: async (missing) => {
      // CreateProductTagDTO accepts `value` only — no metadata, no handle.
      await createProductTagsWorkflow(container).run({
        input: { product_tags: missing.map((t) => ({ value: t.value })) },
      })
    },
  })

  return { categories: withChildren, types, collections, tags }
}
