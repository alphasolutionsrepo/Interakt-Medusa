import {
  createWorkflow,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { fetchSearchProductsStep } from "./steps/fetch-search-products"
import { buildSearchDocumentsStep } from "./steps/build-search-documents"
import { loadSearchDocumentsStep } from "./steps/load-search-documents"

export interface ReindexSearchInput {
  /** Keep only products whose id or `external_id` is listed. */
  only?: string[]
  /** Keep at most this many products. */
  limit?: number
  /** Build and return documents without pushing anything. */
  dryRun?: boolean
  sourceFileName?: string
}

/**
 * Full catalogue reload.
 *
 * Returns the built documents as well as the push result so the CLI can print
 * its coverage report over exactly what was sent — the report and the payload
 * must not be built twice, or they can disagree.
 *
 * `dryRun` skips only the final step. Everything before it still runs, which is
 * the point: a dry run exercises the real fetch and the real mapping.
 */
export const reindexSearchWorkflow = createWorkflow(
  "reindex-search",
  function (input: ReindexSearchInput) {
    const fetched = fetchSearchProductsStep({
      only: input.only,
      limit: input.limit,
    })

    const built = buildSearchDocumentsStep({
      products: fetched.products,
      availability: fetched.availability,
      missingIds: fetched.missingIds,
    })

    const load = when({ dryRun: input.dryRun }, (data) => !data.dryRun).then(() =>
      loadSearchDocumentsStep({
        documents: built.documents,
        sourceFileName: input.sourceFileName,
      })
    )

    return new WorkflowResponse({
      documents: built.documents,
      warnings: built.warnings,
      load,
    })
  }
)

export default reindexSearchWorkflow
