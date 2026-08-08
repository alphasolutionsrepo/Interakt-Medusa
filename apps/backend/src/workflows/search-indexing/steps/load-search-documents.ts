import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SEARCH_INDEX_MODULE } from "../../../modules/search-index"
import SearchIndexClientService from "../../../modules/search-index/service"
import { LoadResult } from "../../../modules/search-index/types"
import { SearchDocument } from "../document"

export interface LoadSearchDocumentsInput {
  documents: SearchDocument[]
  /** Recorded on the Interakt batch for provenance. */
  sourceFileName?: string
}

/**
 * Push a full catalogue load, provisioning the index if it does not exist.
 *
 * No compensation, deliberately. A whole-catalogue reload has no prior state
 * worth restoring — the previous contents were the same documents one version
 * older, and re-running the load is the recovery path. Snapshotting every
 * document to enable a rollback would double the request count for a rollback
 * nobody would choose over simply reloading.
 *
 * This upserts. Documents in the index that are absent from `documents` are
 * left untouched; see the orphan note in the reindex script.
 */
export const loadSearchDocumentsStep = createStep(
  "load-search-documents",
  async (input: LoadSearchDocumentsInput, { container }) => {
    const searchIndex = container.resolve<SearchIndexClientService>(SEARCH_INDEX_MODULE)

    const result = await searchIndex.loadDocuments(
      input.documents as unknown as Record<string, unknown>[],
      input.sourceFileName
    )

    return new StepResponse<LoadResult>(result)
  }
)
