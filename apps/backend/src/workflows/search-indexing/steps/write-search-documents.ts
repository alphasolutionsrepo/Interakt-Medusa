import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SEARCH_INDEX_MODULE } from "../../../modules/search-index"
import SearchIndexClientService from "../../../modules/search-index/service"
import {
  DocumentWriteOperation,
  WriteResult,
} from "../../../modules/search-index/types"
import { SearchDocument } from "../document"

export interface WriteSearchDocumentsInput {
  documents?: SearchDocument[]
  removeIds?: string[]
}

/** What the compensation needs to put the index back. */
interface PriorState {
  documentId: string
  /** `null` means the document did not exist and must be deleted on rollback. */
  document: Record<string, unknown> | null
}

export const writeSearchDocumentsStep = createStep(
  "write-search-documents",
  async (input: WriteSearchDocumentsInput, { container }) => {
    const searchIndex = container.resolve<SearchIndexClientService>(SEARCH_INDEX_MODULE)

    const documents = input.documents ?? []
    const removeIds = input.removeIds ?? []

    if (!documents.length && !removeIds.length) {
      return new StepResponse<WriteResult, PriorState[]>(
        {
          success: true,
          summary: {
            total: 0,
            succeeded: 0,
            failed: 0,
            counts: { upload: 0, merge: 0, delete: 0 },
          },
          errors: [],
          warnings: [],
        },
        []
      )
    }

    // Snapshot before mutating, so the compensation has something to restore.
    // Affordable here because this path is driven by subscribers and handles one
    // or two documents at a time — it is explicitly not used for a full reload.
    const touchedIds = [...documents.map((d) => d.productId), ...removeIds]
    const prior: PriorState[] = await Promise.all(
      touchedIds.map(async (documentId) => ({
        documentId,
        document: await searchIndex.readDocument(documentId),
      }))
    )

    const operations: DocumentWriteOperation[] = [
      ...documents.map((document) => ({
        action: "upload" as const,
        document: document as unknown as Record<string, unknown>,
      })),
      ...removeIds.map((documentId) => ({ action: "delete" as const, documentId })),
    ]

    const result = await searchIndex.writeDocuments(operations)

    return new StepResponse<WriteResult, PriorState[]>(result, prior)
  },

  async (prior, { container }) => {
    if (!prior?.length) {
      return
    }

    const searchIndex = container.resolve<SearchIndexClientService>(SEARCH_INDEX_MODULE)

    // Restore what was there; delete what was not. Both directions matter — a
    // rollback that only deleted would erase documents the failed write updated.
    const operations: DocumentWriteOperation[] = prior.map((state) =>
      state.document
        ? {
            action: "upload" as const,
            document: state.document,
            documentId: state.documentId,
          }
        : { action: "delete" as const, documentId: state.documentId }
    )

    await searchIndex.writeDocuments(operations)
  }
)
