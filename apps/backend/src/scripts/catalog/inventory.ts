import { MedusaContainer } from "@medusajs/framework"
import { Logger } from "@medusajs/framework/types"
import { createInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { chunk, pagedGraph } from "./util"

export interface CreatedVariant {
  id: string
  sku: string | null
}

/**
 * Stock the variants a chunk just created.
 *
 * Deliberately NOT the base seed's pattern of "read every inventory item, then
 * create a level for each": `(inventory_item_id, location_id)` is unique with no
 * dedup guard in the workflow, so that would throw on the items the base seed
 * already levelled. This only touches the items belonging to the given variants,
 * and skips any that are already levelled at this location so a resumed run is
 * safe.
 *
 * Quantities come from the catalog (0-75) rather than a blanket 1,000,000, so
 * genuinely out-of-stock variants read as out of stock in admin and storefront.
 */
export async function createLevelsForVariants(
  container: MedusaContainer,
  logger: Logger,
  opts: {
    variants: CreatedVariant[]
    stockLocationId: string
    stockBySku: Map<string, number>
  }
): Promise<number> {
  const { variants, stockLocationId, stockBySku } = opts
  const variantIds = variants.map((v) => v.id)
  if (!variantIds.length) {
    return 0
  }

  const skuByVariantId = new Map(variants.map((v) => [v.id, v.sku]))

  const links = await pagedGraph<{ variant_id: string; inventory_item_id: string }>(container, {
    entity: "product_variant_inventory_items",
    fields: ["variant_id", "inventory_item_id"],
    filters: { variant_id: variantIds },
  })

  if (!links.length) {
    logger.warn(`inventory: no inventory items found for ${variantIds.length} variants`)
    return 0
  }

  const existingLevels = await pagedGraph<{ inventory_item_id: string }>(container, {
    entity: "inventory_level",
    fields: ["inventory_item_id"],
    filters: {
      inventory_item_id: links.map((l) => l.inventory_item_id),
      location_id: stockLocationId,
    },
  })
  const alreadyLevelled = new Set(existingLevels.map((l) => l.inventory_item_id))

  const levels = links
    .filter((l) => !alreadyLevelled.has(l.inventory_item_id))
    .map((l) => {
      const sku = skuByVariantId.get(l.variant_id)
      return {
        location_id: stockLocationId,
        inventory_item_id: l.inventory_item_id,
        // Create the level even at 0 so admin shows an explicit 0 rather than
        // "not stocked at this location".
        stocked_quantity: (sku ? stockBySku.get(sku) : undefined) ?? 0,
      }
    })

  if (!levels.length) {
    return 0
  }

  for (const batch of chunk(levels, 500)) {
    await createInventoryLevelsWorkflow(container).run({
      input: { inventory_levels: batch },
    })
  }

  return levels.length
}
