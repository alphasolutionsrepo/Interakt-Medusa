import { writeFileSync } from "fs"
import path from "path"
import { MedusaContainer } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  MedusaError,
  QueryContext,
  getTotalVariantAvailability,
} from "@medusajs/framework/utils"
import {
  AvailabilityMap,
  DocumentWarning,
  GraphProduct,
  SEARCH_PRODUCT_FIELDS,
  SearchDocument,
  toSearchDocument,
} from "../workflows/search-indexing/document"
import { chunk, pagedGraph, since, unique } from "./catalog/util"

/**
 * Build the search documents for every published product.
 *
 *   yarn reindex dry-run                              report only, writes nothing
 *   yarn reindex dry-run out=./medusa-products.json   also write the documents to a file
 *   yarn reindex limit=5 verbose
 *   yarn reindex only=PROD-0001,prod_01K...           by external_id OR product id
 *
 * Flags are BARE, not --prefixed: `medusa exec` declares `[args..]` as a
 * variadic positional and its yargs parser rejects unknown --options before
 * they ever reach this script.
 *
 * Pushing to the search index is NOT wired up yet — the index does not exist.
 * Run `dry-run out=...` to produce the documents, create the index from them,
 * then the push path lands in a follow-up.
 */

const CURRENCY = process.env.SEARCH_INDEX_CURRENCY ?? "usd"

/** Availability is fetched in batches so the internal query stays bounded. */
const AVAILABILITY_BATCH = 1000

interface Options {
  dryRun: boolean
  out?: string
  limit?: number
  only?: Set<string>
  verbose: boolean
}

function parseArgs(args: string[]): Options {
  const tokens = (args ?? []).map((a) => a.replace(/^--/, ""))
  const flag = (n: string) => tokens.includes(n)
  const value = (n: string) => {
    const eq = tokens.find((t) => t.startsWith(`${n}=`))
    if (eq) return eq.slice(n.length + 1)
    const at = tokens.indexOf(n)
    return at !== -1 ? tokens[at + 1] : undefined
  }

  const limit = value("limit")
  const only = value("only")

  return {
    dryRun: flag("dry-run"),
    out: value("out"),
    limit: limit ? Number(limit) : undefined,
    only: only ? new Set(only.split(",").map((s) => s.trim())) : undefined,
    verbose: flag("verbose"),
  }
}

async function fetchAvailability(
  container: MedusaContainer,
  variantIds: string[]
): Promise<AvailabilityMap> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const out: AvailabilityMap = {}

  for (const batch of chunk(variantIds, AVAILABILITY_BATCH)) {
    const result = await getTotalVariantAvailability(query, {
      variant_ids: batch,
    })
    Object.assign(out, result)
  }

  return out
}

export default async function reindexSearch({
  container,
  args,
}: {
  container: MedusaContainer
  args: string[]
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const options = parseArgs(args ?? [])
  const started = Date.now()

  logger.info(`=== search reindex ===${options.dryRun ? " (dry run)" : ""}`)

  // --- Load products -------------------------------------------------------
  // `calculated_price` is unresolvable without a pricing context; currency_code
  // alone is sufficient (region_id only drives tax-inclusivity, unused here).
  let products = await pagedGraph<GraphProduct>(container, {
    entity: "product",
    fields: SEARCH_PRODUCT_FIELDS,
    filters: { status: "published" },
    context: {
      variants: { calculated_price: QueryContext({ currency_code: CURRENCY }) },
    },
  })

  if (options.only) {
    products = products.filter(
      (p) =>
        options.only!.has(p.id) ||
        (p.external_id ? options.only!.has(p.external_id) : false)
    )
  }
  if (options.limit) {
    products = products.slice(0, options.limit)
  }

  logger.info(`products: ${products.length} published`)

  if (!products.length) {
    logger.warn("nothing to index")
    return
  }

  // --- Availability (stocked - reserved, across all locations) -------------
  const variantIds = unique(
    products.flatMap((p) => (p.variants ?? []).map((v) => v.id))
  )
  const availability = await fetchAvailability(container, variantIds)
  logger.info(`variants: ${variantIds.length}, availability resolved`)

  // --- Map -----------------------------------------------------------------
  const warnings: DocumentWarning[] = []
  const documents: SearchDocument[] = products.map((p) =>
    toSearchDocument(p, availability, warnings)
  )

  // --- Coverage report -----------------------------------------------------
  const nulls = (key: keyof SearchDocument) =>
    documents.filter((d) => d[key] === null || d[key] === undefined).length

  const coverage: [string, number][] = [
    ["externalId", nulls("externalId")],
    ["brand", nulls("brand")],
    ["category", nulls("category")],
    ["subCategory", nulls("subCategory")],
    ["gender", nulls("gender")],
    ["ageGroup", nulls("ageGroup")],
    ["season", nulls("season")],
    ["style", nulls("style")],
    ["material", nulls("material")],
    ["primaryColor", nulls("primaryColor")],
    ["careInstructions", nulls("careInstructions")],
    ["rating", nulls("rating")],
    ["ratingCount", nulls("ratingCount")],
    ["hasDiscount", nulls("hasDiscount")],
    ["primaryImageUrl", nulls("primaryImageUrl")],
  ]

  logger.info("--- field coverage (count of MISSING values) ---")
  for (const [field, missing] of coverage) {
    logger.info(`  ${field.padEnd(18)} ${missing === 0 ? "ok" : `${missing} missing`}`)
  }

  const variantCount = documents.reduce((n, d) => n + d.variants.length, 0)
  const noPrice = documents.reduce(
    (n, d) => n + d.variants.filter((v) => v.price === null).length,
    0
  )
  const inStock = documents.filter((d) => d.variants.some((v) => v.inStock)).length
  logger.info(
    `  variants           ${variantCount} (${noPrice} without a ${CURRENCY.toUpperCase()} price)`
  )
  logger.info(`  products in stock  ${inStock}/${documents.length}`)

  // --- Payload sizing (the 10MB request ceiling is the real constraint) ----
  const totalBytes = Buffer.byteLength(JSON.stringify(documents))
  const perDoc = documents.map((d) => Buffer.byteLength(JSON.stringify(d)))
  const maxDoc = Math.max(...perDoc)
  logger.info(
    `payload: ${(totalBytes / 1024 / 1024).toFixed(2)} MB total, ` +
      `largest document ${(maxDoc / 1024).toFixed(1)} KB, ` +
      `mean ${(totalBytes / documents.length / 1024).toFixed(1)} KB`
  )

  // --- Warnings ------------------------------------------------------------
  if (warnings.length) {
    const byField = new Map<string, DocumentWarning[]>()
    for (const w of warnings) {
      const list = byField.get(w.field) ?? []
      list.push(w)
      byField.set(w.field, list)
    }
    logger.warn(`${warnings.length} document warning(s):`)
    for (const [field, list] of byField) {
      const sample = list
        .slice(0, options.verbose ? list.length : 3)
        .map((w) => w.detail)
        .join("; ")
      logger.warn(
        `  ${field}: ${list.length}x — ${sample}` +
          (!options.verbose && list.length > 3 ? " …(verbose for all)" : "")
      )
    }
  } else {
    logger.info("no document warnings")
  }

  // --- Output --------------------------------------------------------------
  if (options.out) {
    const target = path.resolve(process.cwd(), options.out)
    writeFileSync(target, `${JSON.stringify(documents, null, 2)}\n`, "utf-8")
    logger.info(`wrote ${documents.length} documents -> ${target}`)
  }

  if (options.verbose || options.dryRun) {
    logger.info("--- first document ---")
    logger.info(JSON.stringify(documents[0], null, 2))
  }

  if (!options.dryRun) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Pushing to the search index is not wired up yet — the index does not exist.\n" +
        "  1. yarn reindex dry-run out=./medusa-products.json\n" +
        "  2. create the `medusa-products` index in interakt from those documents\n" +
        "  3. record SEARCH_INDEX_ID and SEARCH_INDEX_API_KEY in apps/backend/.env"
    )
  }

  logger.info(`=== dry run complete in ${since(started)} ===`)
  await new Promise((resolve) => setTimeout(resolve, 100))
}
