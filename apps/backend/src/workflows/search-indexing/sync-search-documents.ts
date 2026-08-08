import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { fetchSearchProductsStep } from "./steps/fetch-search-products"
import { buildSearchDocumentsStep } from "./steps/build-search-documents"
import { writeSearchDocumentsStep } from "./steps/write-search-documents"

export interface SyncSearchDocumentsInput {
  productIds: string[]
}

/**
 * Bring the index in line with the current state of specific products.
 *
 * Drives `product.created` and `product.updated` from one path: the build step
 * decides per product whether the outcome is an upsert or a removal, so a
 * newly-drafted or since-deleted product is handled without the caller having
 * to know which event it was reacting to.
 */
export const syncSearchDocumentsWorkflow = createWorkflow(
  "sync-search-documents",
  function (input: SyncSearchDocumentsInput) {
    const fetched = fetchSearchProductsStep({ productIds: input.productIds })

    const built = buildSearchDocumentsStep({
      products: fetched.products,
      availability: fetched.availability,
      missingIds: fetched.missingIds,
    })

    const result = writeSearchDocumentsStep({
      documents: built.documents,
      removeIds: built.removeIds,
    })

    return new WorkflowResponse(result)
  }
)

export default syncSearchDocumentsWorkflow
