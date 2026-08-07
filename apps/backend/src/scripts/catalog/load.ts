import { existsSync, readFileSync } from "fs"
import path from "path"
import { Logger } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { CatalogProduct } from "./types"
import { COLOR_VALUES, SIZE_VALUES } from "./options"

const DATA_FILE = "data/fashion-catalog.json"

/**
 * `medusa exec` resolves relative paths against `process.cwd()`, which is
 * `apps/backend` for both `yarn seed` and `yarn backend:seed` (turbo runs
 * package scripts with cwd = the package dir). The `__dirname` fallbacks cover
 * being run from the repo root or from a built `.medusa/server`.
 */
function resolveCatalogPath(): string {
  const candidates = [
    ...(process.env.CATALOG_FILE ? [path.resolve(process.env.CATALOG_FILE)] : []),
    path.resolve(process.cwd(), DATA_FILE),
    path.resolve(__dirname, "../../..", DATA_FILE),
    path.resolve(__dirname, "../../../..", DATA_FILE),
  ]

  const found = candidates.find((c) => existsSync(c))
  if (!found) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Catalog file not found. Looked in:\n${candidates.map((c) => `  ${c}`).join("\n")}\n` +
        `Copy it with:\n  mkdir -p apps/backend/data && cp <source>/fashion_catalog.json apps/backend/${DATA_FILE}\n` +
        `Or set CATALOG_FILE=/absolute/path.json`
    )
  }

  return found
}

export interface CatalogWarning {
  kind: string
  detail: string
}

export interface LoadedCatalog {
  products: CatalogProduct[]
  path: string
  warnings: CatalogWarning[]
}

/**
 * Read and validate the catalog. Throws with every violation listed at once
 * rather than failing on the first one, so bad data is fixed in a single pass.
 * Recoverable oddities (duplicate SKUs, duplicate names, missing images) are
 * returned as warnings and handled by the transforms.
 */
export function loadCatalog(logger: Logger): LoadedCatalog {
  const file = resolveCatalogPath()
  const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"))

  if (!Array.isArray(parsed)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Catalog at ${file} is not a JSON array`
    )
  }

  const products = parsed as CatalogProduct[]
  const errors: string[] = []
  const warnings: CatalogWarning[] = []

  const sizeSet = new Set(SIZE_VALUES)
  const colorSet = new Set(COLOR_VALUES)
  const seenIds = new Set<string>()
  const skuCounts = new Map<string, number>()
  const nameCounts = new Map<string, number>()

  for (const p of products) {
    const at = p.productId ?? "<missing productId>"

    if (!p.productId) {
      errors.push(`product with name "${p.name}" has no productId`)
    } else if (seenIds.has(p.productId)) {
      errors.push(`${at}: duplicate productId`)
    } else {
      seenIds.add(p.productId)
    }

    if (!p.name) {
      errors.push(`${at}: missing name`)
    }
    if (!p.category?.includes(" > ")) {
      errors.push(`${at}: category "${p.category}" is not "Parent > Child"`)
    }
    if (!Array.isArray(p.variants) || p.variants.length === 0) {
      errors.push(`${at}: has no variants`)
      continue
    }

    nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1)

    const systems = new Set(p.variants.map((v) => v.sizeSystem))
    if (systems.size > 1) {
      errors.push(`${at}: mixes size systems (${[...systems].join(", ")})`)
    }

    const combos = new Set<string>()
    for (const v of p.variants) {
      if (!sizeSet.has(v.size)) {
        errors.push(`${at}: unknown size "${v.size}" (not in the Size option)`)
      }
      if (!colorSet.has(v.color)) {
        errors.push(`${at}: unknown color "${v.color}" (not in the Color option)`)
      }
      if (v.currency !== "USD") {
        errors.push(`${at}: variant ${v.sku} currency is "${v.currency}", expected USD`)
      }
      if (!Number.isFinite(v.price) || v.price <= 0) {
        errors.push(`${at}: variant ${v.sku} has non-positive price ${v.price}`)
      }

      // Medusa rejects two variants with the same option combination.
      const combo = `${v.size}|${v.color}`
      if (combos.has(combo)) {
        errors.push(`${at}: duplicate variant combination ${combo}`)
      }
      combos.add(combo)

      skuCounts.set(v.sku, (skuCounts.get(v.sku) ?? 0) + 1)
    }
  }

  if (errors.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Catalog validation failed with ${errors.length} error(s):\n${errors
        .map((e) => `  - ${e}`)
        .join("\n")}`
    )
  }

  for (const [sku, count] of skuCounts) {
    if (count > 1) {
      warnings.push({ kind: "duplicate-sku", detail: `${sku} appears ${count}x` })
    }
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) {
      warnings.push({ kind: "duplicate-name", detail: `"${name}" appears ${count}x` })
    }
  }
  for (const p of products) {
    if (p.imageGenerationError || !p.primaryImageUrl?.startsWith("/images/")) {
      warnings.push({
        kind: "no-image",
        detail: `${p.productId} has no usable image (${p.imageGenerationError ?? p.primaryImageUrl})`,
      })
    }
  }

  const variantCount = products.reduce((n, p) => n + p.variants.length, 0)
  logger.info(`catalog: ${products.length} products / ${variantCount} variants from ${file}`)
  for (const w of warnings) {
    logger.warn(`catalog ${w.kind}: ${w.detail}`)
  }

  return { products, path: file, warnings }
}
