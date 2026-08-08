import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  QueryContext,
  getTotalVariantAvailability,
} from "@medusajs/framework/utils"
import { pagedGraph, unique } from "../../../utils/query"
import { SEARCH_INDEX_MODULE } from "../../../modules/search-index"
import SearchIndexClientService from "../../../modules/search-index/service"
import { AvailabilityMap, GraphProduct, SEARCH_PRODUCT_FIELDS } from "../document"

/** Availability is fetched in batches so the internal query stays bounded. */
const AVAILABILITY_BATCH = 1000

export interface FetchSearchProductsInput {
  /**
   * Products to fetch. Omit to fetch every published product — that is the
   * full-reload path.
   */
  productIds?: string[]
  /**
   * Full-reload scoping for the CLI: keep only products whose id or
   * `external_id` appears here. Applied after the fetch because `external_id`
   * is not something the caller can filter on up front. A plain array rather
   * than a Set — step inputs are persisted between retries and must serialize.
   */
  only?: string[]
  /** Full-reload scoping for the CLI: keep at most this many products. */
  limit?: number
}

export interface FetchSearchProductsOutput {
  products: GraphProduct[]
  availability: AvailabilityMap
  /** Ids that were asked for but no longer exist. */
  missingIds: string[]
}

/**
 * Load products and their stock availability.
 *
 * Read-only, so no compensation.
 *
 * Note the two filter modes. A full reload asks for `status: "published"` and
 * gets exactly what belongs in the index. An id-scoped fetch deliberately does
 * NOT filter on status: the caller needs to see that a product came back as a
 * draft in order to remove it from the index, and a status filter would make it
 * indistinguishable from one that was deleted. Both cases still end in a
 * delete, but only one of them is worth logging as a surprise.
 */
export const fetchSearchProductsStep = createStep(
  "fetch-search-products",
  async (input: FetchSearchProductsInput, { container }) => {
    const scoped = !!input.productIds
    const requestedIds = input.productIds ?? []

    if (scoped && !requestedIds.length) {
      return new StepResponse<FetchSearchProductsOutput>({
        products: [],
        availability: {},
        missingIds: [],
      })
    }

    const searchIndex = container.resolve<SearchIndexClientService>(SEARCH_INDEX_MODULE)

    // `calculated_price` is unresolvable without a pricing context; currency_code
    // alone is sufficient (region_id only drives tax-inclusivity, unused here).
    let products = await pagedGraph<GraphProduct>(container, {
      entity: "product",
      fields: SEARCH_PRODUCT_FIELDS,
      filters: scoped ? { id: requestedIds } : { status: "published" },
      context: {
        variants: {
          calculated_price: QueryContext({ currency_code: searchIndex.currency }),
        },
      },
    })

    if (input.only?.length) {
      const only = new Set(input.only)
      products = products.filter(
        (p) => only.has(p.id) || (p.external_id ? only.has(p.external_id) : false)
      )
    }
    if (input.limit) {
      products = products.slice(0, input.limit)
    }

    const found = new Set(products.map((p) => p.id))
    const missingIds = requestedIds.filter((id) => !found.has(id))

    // --- Availability (stocked - reserved, across all locations) -------------
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const variantIds = unique(
      products.flatMap((p) => (p.variants ?? []).map((v) => v.id))
    )
    const availability: AvailabilityMap = {}

    for (let i = 0; i < variantIds.length; i += AVAILABILITY_BATCH) {
      const batch = variantIds.slice(i, i + AVAILABILITY_BATCH)
      Object.assign(
        availability,
        await getTotalVariantAvailability(query, { variant_ids: batch })
      )
    }

    return new StepResponse<FetchSearchProductsOutput>({
      products,
      availability,
      missingIds,
    })
  }
)
