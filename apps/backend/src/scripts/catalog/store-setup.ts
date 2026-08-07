import { MedusaContainer } from "@medusajs/framework"
import { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  createRegionsWorkflow,
  createServiceZonesWorkflow,
  createShippingOptionsWorkflow,
  createTaxRegionsWorkflow,
} from "@medusajs/medusa/core-flows"

const US_REGION_NAME = "United States"
const US_ZONE_NAME = "North America"
const US_SHIPPING_OPTIONS = ["Standard Shipping (US)", "Express Shipping (US)"]

export interface StoreContext {
  salesChannelId: string
  shippingProfileId: string
  stockLocationId: string
  usRegionId: string
}

/**
 * Read the things initial-data-seed created. These are hard prerequisites —
 * without them a product cannot be created (shipping profile, sales channel)
 * or stocked (stock location).
 */
async function readPrerequisites(container: MedusaContainer) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const [channels, profiles, locations, sets] = await Promise.all([
    query.graph({ entity: "sales_channel", fields: ["id", "name"] }),
    query.graph({ entity: "shipping_profile", fields: ["id", "name"] }),
    query.graph({ entity: "stock_location", fields: ["id", "name"] }),
    query.graph({
      entity: "fulfillment_set",
      fields: ["id", "name", "service_zones.id", "service_zones.name", "service_zones.geo_zones.country_code"],
    }),
  ])

  const missing: string[] = []
  if (!channels.data.length) missing.push("sales channel")
  if (!profiles.data.length) missing.push("shipping profile")
  if (!locations.data.length) missing.push("stock location")
  if (!sets.data.length) missing.push("fulfillment set")

  if (missing.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Missing prerequisite(s): ${missing.join(", ")}.\n` +
        `Run the base seed first:  yarn workspace @dtc/backend medusa db:migrate`
    )
  }

  return {
    salesChannel: channels.data[0],
    shippingProfile: profiles.data[0],
    stockLocation: locations.data[0],
    fulfillmentSet: sets.data[0],
  }
}

/**
 * Add the US region and give it shipping coverage.
 *
 * The base seed's only service zone covers 7 European countries, so a US cart
 * matches no geo zone, `/store/shipping-options` returns [], and checkout
 * dead-ends before "Place Order" ever appears. Everything here is
 * check-then-create so re-runs are no-ops.
 */
export async function ensureStoreSetup(
  container: MedusaContainer,
  logger: Logger
): Promise<StoreContext> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { salesChannel, shippingProfile, stockLocation, fulfillmentSet } =
    await readPrerequisites(container)

  // --- US region -----------------------------------------------------------
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "countries.iso_2"],
  })

  const existingUsRegion = regions.find((r) =>
    (r.countries ?? []).some((c) => c?.iso_2 === "us")
  )

  let usRegionId: string
  if (!existingUsRegion) {
    // payment_providers is required: without it /store/payment-providers
    // returns [] and the checkout Payment step renders empty.
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: US_REGION_NAME,
            currency_code: "usd",
            countries: ["us"],
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    })
    usRegionId = result[0].id
    logger.info(`region: created "${US_REGION_NAME}" (usd)`)
  } else {
    usRegionId = existingUsRegion.id
    logger.info(`region: "${existingUsRegion.name}" already covers us`)
  }

  // --- US tax region -------------------------------------------------------
  const { data: taxRegions } = await query.graph({
    entity: "tax_region",
    fields: ["id", "country_code"],
  })

  if (!taxRegions.some((t) => t.country_code === "us")) {
    // Bare array input, matching the base seed.
    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: "us", provider_id: "tp_system" }],
    })
    logger.info("tax region: created us")
  } else {
    logger.info("tax region: us already exists")
  }

  // --- US service zone on the EXISTING fulfillment set ---------------------
  // Reusing the set matters: it is already linked to the stock location, which
  // is in turn linked to the sales channel. A second set would need both links.
  const zones = (fulfillmentSet.service_zones ?? []) as {
    id: string
    name: string
    geo_zones?: { country_code?: string }[]
  }[]

  const existingUsZone = zones.find((z) =>
    (z.geo_zones ?? []).some((g) => g?.country_code === "us")
  )

  let usZoneId: string
  if (!existingUsZone) {
    const { result } = await createServiceZonesWorkflow(container).run({
      input: {
        data: [
          {
            name: US_ZONE_NAME,
            fulfillment_set_id: fulfillmentSet.id,
            geo_zones: [{ type: "country", country_code: "us" }],
          },
        ],
      },
    })
    usZoneId = result[0].id
    logger.info(`service zone: created "${US_ZONE_NAME}" covering us`)
  } else {
    usZoneId = existingUsZone.id
    logger.info(`service zone: "${existingUsZone.name}" already covers us`)
  }

  // --- US shipping options -------------------------------------------------
  // Shipping options have no uniqueness constraint, so this is the one place a
  // re-run could silently duplicate. Guard on (name, service_zone_id).
  const { data: existingOptions } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name", "service_zone_id"],
  })

  const alreadyThere = new Set(
    existingOptions.filter((o) => o.service_zone_id === usZoneId).map((o) => o.name)
  )
  const wanted = US_SHIPPING_OPTIONS.filter((name) => !alreadyThere.has(name))

  if (wanted.length) {
    await createShippingOptionsWorkflow(container).run({
      input: wanted.map((name) => ({
        name,
        price_type: "flat" as const,
        provider_id: "manual_manual",
        service_zone_id: usZoneId,
        shipping_profile_id: shippingProfile.id,
        type: name.startsWith("Express")
          ? { label: "Express", description: "Ship in 24 hours.", code: "express" }
          : { label: "Standard", description: "Ship in 2-3 days.", code: "standard" },
        prices: [
          { currency_code: "usd", amount: 10 },
          { region_id: usRegionId, amount: 10 },
        ],
        // Without these two rules the option is hidden from the store API.
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" as const },
          { attribute: "is_return", value: "false", operator: "eq" as const },
        ],
      })),
    })
    logger.info(`shipping options: created ${wanted.join(", ")}`)
  } else {
    logger.info("shipping options: us options already exist")
  }

  return {
    salesChannelId: salesChannel.id,
    shippingProfileId: shippingProfile.id,
    stockLocationId: stockLocation.id,
    usRegionId,
  }
}
