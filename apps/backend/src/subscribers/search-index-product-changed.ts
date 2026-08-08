import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { syncSearchDocumentsWorkflow } from "../workflows/search-indexing/sync-search-documents"

/**
 * Keep the search index in step with product edits.
 *
 * Covers create and update together because the workflow decides the outcome
 * from the product's current state, not from which event arrived: a product
 * flipped to draft is removed, a published one is upserted.
 *
 * Bulk caveat: Medusa emits one event per product, so a catalogue import fires
 * hundreds of these and each becomes an Interakt request against a 60/min
 * per-key ceiling. The client backs off, but the sane path after a bulk import
 * is `yarn reindex`, not this subscriber.
 */
export default async function searchIndexProductChangedHandler({
  event: { name: eventName, data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const { result } = await syncSearchDocumentsWorkflow(container).run({
      input: { productIds: [data.id] },
    })

    logger.info(
      `search index: ${eventName} ${data.id} -> ` +
        `${result.summary.counts.upload} upserted, ${result.summary.counts.delete} removed`
    )
  } catch (e) {
    // Never rethrow. This runs after the product was already saved, and letting
    // it fail would surface an Interakt outage as a failed admin operation.
    logger.error(
      `search index: failed to sync product ${data.id} after ${eventName} — ` +
        `${(e as Error).message}. The document is now stale; run \`yarn reindex\` to repair.`
    )
  }
}

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated"],
}
