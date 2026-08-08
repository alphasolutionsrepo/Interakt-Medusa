import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  AvailabilityMap,
  DocumentWarning,
  GraphProduct,
  SearchDocument,
  toSearchDocument,
} from "../document"

export interface BuildSearchDocumentsInput {
  products: GraphProduct[]
  availability: AvailabilityMap
  /** Ids that were asked for but no longer exist, from the fetch step. */
  missingIds?: string[]
}

export interface BuildSearchDocumentsOutput {
  documents: SearchDocument[]
  /** Document ids to remove from the index. */
  removeIds: string[]
  warnings: DocumentWarning[]
}

/**
 * Map products to search documents, and decide which ones must instead be
 * removed from the index.
 *
 * This is where an unpublish becomes a delete. `product.updated` fires when an
 * admin flips a product to draft, and upserting it would leave it searchable —
 * so anything that is not `published` joins the ids that no longer exist at all.
 * Both are removals as far as the index is concerned.
 *
 * Removal by product id works only because the index maps `uniqueId` to
 * `productId` (`{mode: reference, sourceFromField: productId}` in
 * data/medusa-products-index-mapping.json). Change that mapping and this breaks.
 *
 * Pure, so no compensation.
 */
export const buildSearchDocumentsStep = createStep(
  "build-search-documents",
  async (input: BuildSearchDocumentsInput) => {
    const warnings: DocumentWarning[] = []
    const documents: SearchDocument[] = []
    const removeIds: string[] = [...(input.missingIds ?? [])]

    for (const product of input.products) {
      if (product.status !== "published") {
        removeIds.push(product.id)
        continue
      }
      documents.push(toSearchDocument(product, input.availability, warnings))
    }

    return new StepResponse<BuildSearchDocumentsOutput>({
      documents,
      removeIds,
      warnings,
    })
  }
)
