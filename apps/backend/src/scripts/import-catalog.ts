import { MedusaContainer } from "@medusajs/framework"
import { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, toHandle } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { createLevelsForVariants } from "./catalog/inventory"
import { loadCatalog } from "./catalog/load"
import {
  COLOR_OPTION,
  COLOR_VALUES,
  SIZE_OPTION,
  SIZE_VALUES,
  ensureSharedOptions,
} from "./catalog/options"
import { ensureStoreSetup } from "./catalog/store-setup"
import {
  childHandleOf,
  describeTaxonomy,
  ensureTaxonomy,
  parentHandleOf,
  tagValuesOf,
} from "./catalog/taxonomy"
import { IMAGE_BASE, createTransformer } from "./catalog/transform"
import { CatalogProduct } from "./catalog/types"
import { chunk, pagedGraph, parseOptions, since } from "./catalog/util"

/**
 * Import the fashion catalog (200 products / 1089 variants) into Medusa.
 *
 *   yarn seed dry-run          # validate + preview, write nothing
 *   yarn seed limit=5          # smoke test the first 5 products
 *   yarn backend:seed          # full run, from the repo root
 *
 * Flags (bare, not --prefixed: medusa exec's parser swallows unknown options):
 *   dry-run, verbose, limit=N, chunk-size=N, only=PROD-0001,PROD-0070
 *
 * Re-runnable: every phase reads current state first and creates only what is
 * missing, and products are keyed on `external_id` (the catalog productId).
 */
/**
 * Read-only report of what a real run would do. Touches nothing.
 */
async function reportDryRun(
  container: MedusaContainer,
  logger: Logger,
  ctx: { products: CatalogProduct[]; pending: CatalogProduct[]; skipped: number }
) {
  for (const plan of describeTaxonomy(ctx.products)) {
    const existing = await pagedGraph<Record<string, string>>(container, {
      entity: plan.entity,
      fields: ["id", plan.keyField],
    })
    const present = new Set(existing.map((e) => e[plan.keyField]))
    const missing = plan.keys.filter((k) => !present.has(k)).length
    logger.info(`${plan.label}: ${plan.keys.length} needed, ${missing} would be created`)
  }

  const sharedOptions = await pagedGraph<{ title: string; values?: unknown[] }>(container, {
    entity: "product_option",
    fields: ["title", "values.value"],
    filters: { is_exclusive: false },
  })
  for (const spec of [
    { title: SIZE_OPTION, values: SIZE_VALUES },
    { title: COLOR_OPTION, values: COLOR_VALUES },
  ]) {
    const current = sharedOptions.find((o) => o.title === spec.title)
    const have = current?.values?.length ?? 0
    logger.info(
      current
        ? `option "${spec.title}": ${have} existing values, would extend to ${spec.values.length}`
        : `option "${spec.title}": would be created with ${spec.values.length} values`
    )
  }

  logger.info(
    `products: ${ctx.pending.length} would be created, ${ctx.skipped} already imported`
  )
  logger.info(`images would resolve under ${IMAGE_BASE}`)

  for (const p of ctx.pending.slice(0, 3)) {
    const sizes = [...new Set(p.variants.map((v) => v.size))]
    const colors = [...new Set(p.variants.map((v) => v.color))]
    logger.info(
      `  ${p.productId} "${p.name}" -> handle=${toHandle(p.name)} ` +
        `type="${p.subCategory}" collection=${toHandle(p.brand)} ` +
        `categories=[${parentHandleOf(p)}, ${childHandleOf(p)}] ` +
        `variants=${p.variants.length} sizes=[${sizes.join(",")}] colors=[${colors.join(",")}] ` +
        `tags=${tagValuesOf(p).length}`
    )
  }
}

export default async function importCatalog({
  container,
  args,
}: {
  container: MedusaContainer
  args: string[]
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const options = parseOptions(args ?? [])
  const started = Date.now()

  logger.info(`=== fashion catalog import ===${options.dryRun ? " (dry run)" : ""}`)

  // --- Phase 0: load + validate (no writes) --------------------------------
  const { products: all, warnings } = loadCatalog(logger)

  let products = all
  if (options.only) {
    products = products.filter((p) => options.only!.has(p.productId))
  }
  if (options.limit) {
    products = products.slice(0, options.limit)
  }

  // --- Existing state, for idempotency ------------------------------------
  const existingProducts = await pagedGraph<{
    id: string
    handle: string
    external_id: string | null
  }>(container, { entity: "product", fields: ["id", "handle", "external_id"] })

  const importedIds = new Set(
    existingProducts.map((p) => p.external_id).filter((v): v is string => !!v)
  )
  const existingHandles = new Set(existingProducts.map((p) => p.handle))

  const existingVariants = await pagedGraph<{ sku: string | null }>(container, {
    entity: "product_variant",
    fields: ["sku"],
  })
  const existingSkus = new Set(
    existingVariants.map((v) => v.sku).filter((v): v is string => !!v)
  )

  const pending = products.filter((p) => !importedIds.has(p.productId))
  const skipped = products.length - pending.length

  // --- Dry run: report only, before anything is written --------------------
  if (options.dryRun) {
    await reportDryRun(container, logger, { products, pending, skipped })
    logger.info(`=== dry run complete in ${since(started)} ===`)
    return
  }

  // --- Phase 1: store setup ------------------------------------------------
  const store = await ensureStoreSetup(container, logger)

  // --- Phase 2: taxonomy ---------------------------------------------------
  const taxonomy = await ensureTaxonomy(container, logger, products)

  // --- Phase 3: shared options --------------------------------------------
  const sharedOptions = await ensureSharedOptions(container, logger)

  const transformer = createTransformer({
    products: pending,
    taxonomy,
    options: sharedOptions,
    store,
    existingHandles,
    existingSkus,
    logger,
  })

  if (!pending.length) {
    logger.info(`nothing to do: all ${products.length} product(s) already imported`)
    logger.info(`=== import complete in ${since(started)} ===`)
    return
  }

  // --- Phase 4 + 5: products in chunks, each stocked immediately ----------
  // One chunk is one workflow transaction: a failure rolls the whole chunk back,
  // so chunking bounds the blast radius and keeps the rest of the run going.
  const batches = chunk(pending, options.chunkSize)
  const failures: { productIds: string[]; error: string }[] = []
  let created = 0
  let levelsCreated = 0

  for (const [i, batch] of batches.entries()) {
    const t0 = Date.now()

    try {
      const { result } = await createProductsWorkflow(container).run({
        input: { products: batch.map((p: CatalogProduct) => transformer.toProductInput(p)) },
      })

      created += result.length

      const variants = result.flatMap((p) =>
        (p.variants ?? []).map((v) => ({ id: v.id, sku: v.sku ?? null }))
      )
      levelsCreated += await createLevelsForVariants(container, logger, {
        variants,
        stockLocationId: store.stockLocationId,
        stockBySku: transformer.stockBySku,
      })

      logger.info(
        `chunk ${i + 1}/${batches.length}: +${result.length} products, ` +
          `${variants.length} variants (${created}/${pending.length}) ${Date.now() - t0}ms`
      )
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      failures.push({ productIds: batch.map((p) => p.productId), error })
      logger.error(
        `chunk ${i + 1}/${batches.length} FAILED [${batch.map((p) => p.productId).join(", ")}]: ${error}`
      )
      if (options.verbose) {
        logger.error(JSON.stringify(batch.map((p) => transformer.toProductInput(p)), null, 2))
      }
    }
  }

  // --- Phase 6: summary ---------------------------------------------------
  const { stats } = transformer
  logger.info("=== import summary ===")
  logger.info(`products:   created ${created}, skipped ${skipped}, failed ${failures.length} chunk(s)`)
  logger.info(`inventory:  ${levelsCreated} levels created`)
  logger.info(`handles:    ${stats.handlesSuffixed} disambiguated with a productId suffix`)
  logger.info(`skus:       ${stats.skusRewritten} rewritten for uniqueness`)
  logger.info(`images:     ${stats.imagesAttached} attached, ${stats.imagesSkipped} skipped`)
  logger.info(
    `taxonomy:   ${taxonomy.categories.size} categories, ${taxonomy.types.size} types, ` +
      `${taxonomy.collections.size} collections, ${taxonomy.tags.size} tags`
  )
  logger.info(`warnings:   ${warnings.length} (see above)`)
  logger.info(`=== ${failures.length ? "completed with errors" : "import complete"} in ${since(started)} ===`)

  if (failures.length) {
    process.exitCode = 1
  }

  // `medusa exec` calls process.exit() as soon as this resolves; give the
  // logger a moment to flush.
  await new Promise((resolve) => setTimeout(resolve, 100))
}
