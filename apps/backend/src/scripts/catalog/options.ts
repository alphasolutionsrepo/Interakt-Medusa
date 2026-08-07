import { MedusaContainer } from "@medusajs/framework"
import { Logger } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import {
  createProductOptionsWorkflow,
  updateProductOptionsWorkflow,
} from "@medusajs/medusa/core-flows"
import { pagedGraph, unique } from "./util"

export const SIZE_OPTION = "Size"
export const COLOR_OPTION = "Color"

/**
 * Alpha sizes in wearing order, then numeric waists, then shoe sizes.
 *
 * All three families live in ONE shared `Size` option on purpose. The store
 * option filter is OR within an option group but AND *across* groups, and no
 * catalog product mixes size systems — so splitting these into `Size`/`Waist`/
 * `Shoe Size` would make any cross-family facet selection return 0 products.
 * A single group ORs them, which is what a shopper expects.
 */
const ALPHA_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"]
const WAIST_SIZES = ["24", "25", "26", "27", "28", "29", "30", "31", "32", "34", "36", "38", "40"]
const SHOE_SIZES = [
  "US 5", "US 5.5", "US 6", "US 6.5", "US 7", "US 7.5", "US 8",
  "US 8.5", "US 9", "US 9.5", "US 10", "US 11", "US 12", "US 13",
]

export const SIZE_VALUES = [...ALPHA_SIZES, ...WAIST_SIZES, ...SHOE_SIZES]

export const COLOR_VALUES = [
  "Beige", "Black", "Blush Pink", "Burgundy", "Burnt Orange", "Camel",
  "Charcoal Grey", "Chocolate Brown", "Cobalt Blue", "Coral", "Cream",
  "Dark Denim", "Deep Red", "Dusty Rose", "Forest Green", "Ivory", "Lavender",
  "Light Denim", "Light Grey", "Mint Green", "Mustard Yellow", "Navy Blue",
  "Olive Green", "Sage Green", "Sky Blue", "Soft Lilac", "Tan", "Teal",
  "Washed Indigo", "White",
]

const OPTION_SPECS = [
  { title: SIZE_OPTION, values: SIZE_VALUES },
  { title: COLOR_OPTION, values: COLOR_VALUES },
]

export interface SharedOption {
  id: string
  title: string
  valueIdByValue: Map<string, string>
  /** Index in the canonical value list, for deterministic ordering. */
  rankByValue: Map<string, number>
}

export type SharedOptions = Map<string, SharedOption>

interface RawOption {
  id: string
  title: string
  values?: { id: string; value: string; rank: number | null }[]
}

async function readSharedOptions(container: MedusaContainer): Promise<RawOption[]> {
  return pagedGraph<RawOption>(container, {
    entity: "product_option",
    fields: ["id", "title", "values.id", "values.value", "values.rank"],
    filters: { is_exclusive: false },
  })
}

function ranksFor(values: string[]): Record<string, number> {
  return Object.fromEntries(values.map((v, i) => [v, i + 1]))
}

/**
 * Ensure the two shared options exist and carry every value the catalog needs.
 *
 * `Size` and `Color` already exist as shared options (created by
 * initial-data-seed with S,M,L,XL and Black,White). Shared option titles are
 * globally unique, so they must be EXTENDED, not re-created. The update must
 * pass a strict superset: dropping a value that a product already uses throws
 * "Cannot delete product option values that are associated with products".
 */
export async function ensureSharedOptions(
  container: MedusaContainer,
  logger: Logger
): Promise<SharedOptions> {
  const existing = await readSharedOptions(container)

  for (const spec of OPTION_SPECS) {
    const current = existing.find((o) => o.title === spec.title)

    if (!current) {
      await createProductOptionsWorkflow(container).run({
        input: {
          product_options: [
            {
              title: spec.title,
              values: spec.values,
              ranks: ranksFor(spec.values),
              is_exclusive: false,
              metadata: { source: "fashion_catalog" },
            },
          ],
        },
      })
      logger.info(`option "${spec.title}": created with ${spec.values.length} values`)
      continue
    }

    const currentValues = (current.values ?? []).map((v) => v.value)
    const wanted = new Set(spec.values)

    // Canonical order FIRST so ranks reflect wearing order (XS -> XXXL), then
    // any pre-existing value the catalog does not know about. Reading the DB's
    // order first would rank whatever the base seed happened to return first,
    // which is arbitrary. The result is still a superset of what exists, which
    // it must be: removing an in-use value throws.
    const desired = unique([...spec.values, ...currentValues.filter((v) => !wanted.has(v))])
    const ranks = ranksFor(desired)

    const added = desired.filter((v) => !currentValues.includes(v)).length
    const misranked = (current.values ?? []).filter((v) => v.rank !== ranks[v.value]).length

    if (added === 0 && misranked === 0) {
      logger.info(`option "${spec.title}": already has all ${desired.length} values, ranks correct`)
      continue
    }

    await updateProductOptionsWorkflow(container).run({
      input: {
        selector: { id: current.id },
        update: { values: desired, ranks },
      },
    })
    logger.info(
      `option "${spec.title}": ${currentValues.length} -> ${desired.length} values ` +
        `(+${added} added, ${misranked} re-ranked)`
    )
  }

  // Re-read as the single source of truth. Neither workflow's return shape is
  // relied on for value ids — one extra query removes the ambiguity.
  const refreshed = await readSharedOptions(container)
  const out: SharedOptions = new Map()

  for (const spec of OPTION_SPECS) {
    const raw = refreshed.find((o) => o.title === spec.title)
    if (!raw) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Import aborted: shared option "${spec.title}" missing after ensure`
      )
    }

    out.set(spec.title, {
      id: raw.id,
      title: raw.title,
      valueIdByValue: new Map((raw.values ?? []).map((v) => [v.value, v.id])),
      rankByValue: new Map(spec.values.map((v, i) => [v, i])),
    })
  }

  return out
}
