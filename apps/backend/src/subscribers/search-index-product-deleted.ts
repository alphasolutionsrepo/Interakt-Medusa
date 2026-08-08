import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { removeSearchDocumentsWorkflow } from "../workflows/search-indexing/remove-search-documents"

/**
 * Drop a deleted product from the search index.
 *
 * The row is gone by the time this runs, so the id in the event is the only
 * thing to work with — which is sufficient because the index keys documents on
 * `productId`.
 */
export default async function searchIndexProductDeletedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    await removeSearchDocumentsWorkflow(container).run({
      input: { productIds: [data.id] },
    })

    logger.info(`search index: removed deleted product ${data.id}`)
  } catch (e) {
    // See the changed-product subscriber: a failed push must not break the
    // delete that triggered it.
    logger.error(
      `search index: failed to remove product ${data.id} — ${(e as Error).message}. ` +
        "The document is now orphaned in the index."
    )
  }
}

export const config: SubscriberConfig = {
  event: "product.deleted",
}
