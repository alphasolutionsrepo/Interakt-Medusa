import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { writeSearchDocumentsStep } from "./steps/write-search-documents"

export interface RemoveSearchDocumentsInput {
  productIds: string[]
}

/**
 * Drop products from the index by id.
 *
 * Separate from the sync workflow because on `product.deleted` the row is
 * already gone — fetching it would return nothing and there is no document to
 * build. All that survives the event is the id, and that is enough only because
 * the index maps `uniqueId` to `productId`.
 */
export const removeSearchDocumentsWorkflow = createWorkflow(
  "remove-search-documents",
  function (input: RemoveSearchDocumentsInput) {
    const result = writeSearchDocumentsStep({ removeIds: input.productIds })

    return new WorkflowResponse(result)
  }
)

export default removeSearchDocumentsWorkflow
