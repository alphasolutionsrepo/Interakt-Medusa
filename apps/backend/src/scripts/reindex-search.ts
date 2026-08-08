import { writeFileSync } from "fs"
import path from "path"
import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { DocumentWarning, SearchDocument } from "../workflows/search-indexing/document"
import { reindexSearchWorkflow } from "../workflows/search-indexing/reindex-search"
import { SEARCH_INDEX_MODULE } from "../modules/search-index"
import SearchIndexClientService from "../modules/search-index/service"
import { since } from "./catalog/util"

/**
 * Build the search documents for every published product, and push them.
 *
 *   yarn reindex                                      build and push
 *   yarn reindex dry-run                              report only, pushes nothing
 *   yarn reindex dry-run out=./medusa-products.json   also write the documents to a file
 *   yarn reindex limit=5 verbose
 *   yarn reindex only=PROD-0001,prod_01K...           by external_id OR product id
 *
 * Flags are BARE, not --prefixed: `medusa exec` declares `[args..]` as a
 * variadic positional and its yargs parser rejects unknown --options before
 * they ever reach this script.
 *
 * Configuration lives in the `searchIndex` module (see medusa-config.ts), so
 * this and the event subscribers agree on the index and the currency.
 *
 * This is also the repair path. Product edits sync automatically via
 * src/subscribers/search-index-product-*.ts, but two things that path cannot
 * cover: a bulk import fires an event per product and will exhaust Interakt's
 * rate limit, and price/inventory/category changes do not emit `product.*`
 * events at all. Run this after either.
 */

interface Options {
  dryRun: boolean
  out?: string
  limit?: number
  only?: string[]
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
    only: only ? only.split(",").map((s) => s.trim()) : undefined,
    verbose: flag("verbose"),
  }
}

export default async function reindexSearch({
  container,
  args,
}: {
  container: MedusaContainer
  args: string[]
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const searchIndex = container.resolve<SearchIndexClientService>(SEARCH_INDEX_MODULE)
  const options = parseArgs(args ?? [])
  const started = Date.now()
  const currency = searchIndex.currency

  logger.info(`=== search reindex ===${options.dryRun ? " (dry run)" : ""}`)

  // Fail on missing credentials before a full catalogue fetch, not after.
  if (!options.dryRun && !searchIndex.isConfigured) {
    logger.error(
      "SEARCH_INDEX_ID / SEARCH_INDEX_API_KEY are not set in apps/backend/.env.\n" +
        "  1. yarn reindex dry-run out=./medusa-products.json\n" +
        "  2. create the `medusa-products` index in interakt from those documents,\n" +
        "     importing data/medusa-products-index-mapping.json as its field mapping\n" +
        "  3. mint an ingestion key scoped to that index with `write` AND `delete`\n" +
        "  4. record SEARCH_INDEX_ID (the index UUID, from the interakt page URL)\n" +
        "     and SEARCH_INDEX_API_KEY in apps/backend/.env"
    )
    return
  }

  const { result } = await reindexSearchWorkflow(container).run({
    input: {
      only: options.only,
      limit: options.limit,
      dryRun: options.dryRun,
      sourceFileName: "medusa-reindex",
    },
  })

  const documents = result.documents as SearchDocument[]
  const warnings = result.warnings as DocumentWarning[]

  logger.info(`products: ${documents.length} published`)

  if (!documents.length) {
    logger.warn("nothing to index")
    return
  }

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
    `  variants           ${variantCount} (${noPrice} without a ${currency.toUpperCase()} price)`
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

  // --- Push result ---------------------------------------------------------
  if (options.dryRun) {
    logger.info(`=== dry run complete in ${since(started)} ===`)
    await new Promise((resolve) => setTimeout(resolve, 100))
    return
  }

  const load = result.load

  if (!load) {
    logger.error("push did not run — no result returned from the workflow")
    return
  }

  logger.info(
    `pushed: ${load.summary.indexed}/${load.summary.total} indexed, ` +
      `${load.summary.failed} failed, batch(es) ${load.batchIds.join(", ")}`
  )

  for (const w of load.warnings) {
    logger.warn(`  index warning: ${w}`)
  }
  for (const e of load.errors.slice(0, options.verbose ? load.errors.length : 10)) {
    logger.error(`  index error: ${e.documentId ?? `#${e.documentIndex}`} — ${e.error}`)
  }
  if (!options.verbose && load.errors.length > 10) {
    logger.error(`  …and ${load.errors.length - 10} more (verbose for all)`)
  }

  if (!load.success || load.summary.failed > 0) {
    logger.error(`=== reindex FAILED after ${since(started)} ===`)
    process.exitCode = 1
    await new Promise((resolve) => setTimeout(resolve, 100))
    return
  }

  logger.info(`=== reindex complete in ${since(started)} ===`)
  await new Promise((resolve) => setTimeout(resolve, 100))
}
