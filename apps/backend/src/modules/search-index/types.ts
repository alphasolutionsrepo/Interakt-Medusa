/**
 * Types for the Interakt search-index client.
 *
 * The response shapes mirror Interakt's own API types
 * (`src/features/document-indexing/document-indexing.types.ts` in that repo).
 * Every endpoint wraps its payload in `{ success, data }` — see `ApiEnvelope`.
 */

/** Module options, supplied from `medusa-config.ts`. */
export interface SearchIndexOptions {
  /** Interakt base URL, e.g. `http://localhost:3000`. */
  baseUrl?: string
  /** UUID of the target index — NOT its name. */
  indexId?: string
  /** Ingestion key (`ik_…`), sent as `Authorization: Bearer`. */
  apiKey?: string
  /** Currency documents are priced in. Defaults to `usd`. */
  currency?: string
}

/**
 * One incremental operation.
 *
 * `documentId` is optional on upload/merge because Interakt falls back to the
 * index's mapped `uniqueId` field, which our mapping points at `productId`.
 * On delete there is no document to derive it from, so it is required.
 */
export type DocumentWriteOperation =
  | {
      action: "upload" | "merge"
      document: Record<string, unknown>
      documentId?: string
    }
  | { action: "delete"; documentId: string }

/** Interakt's standard success/error envelope. */
export type ApiEnvelope<T> =
  | { success: true; data: T }
  | { success: false; error: string; details?: unknown; code?: string }

export interface IndexingError {
  documentIndex: number
  documentId?: string
  error: string
  field?: string
}

export interface WriteError {
  operationIndex: number
  documentId?: string
  error: string
  field?: string
}

/** `POST /documents` — one request. */
export interface IndexDocumentsResponse {
  success: boolean
  batchId: string
  message: string
  summary: { total: number; indexed: number; failed: number }
  errors?: IndexingError[]
  warnings?: string[]
  durationMs: number
}

/** `POST /documents/bulk` — one request. */
export interface WriteDocumentsResponse {
  success: boolean
  message: string
  summary: {
    total: number
    succeeded: number
    failed: number
    counts: { upload: number; merge: number; delete: number }
  }
  errors?: WriteError[]
  warnings?: string[]
  durationMs: number
}

/** `GET /documents/:documentId`. */
export interface GetDocumentResponse {
  documentId: string
  document: Record<string, unknown>
}

/** Aggregate of every batch a full load was split into. */
export interface LoadResult {
  success: boolean
  batchIds: string[]
  summary: { total: number; indexed: number; failed: number }
  errors: IndexingError[]
  warnings: string[]
}

/** Aggregate of every batch an incremental write was split into. */
export interface WriteResult {
  success: boolean
  summary: {
    total: number
    succeeded: number
    failed: number
    counts: { upload: number; merge: number; delete: number }
  }
  errors: WriteError[]
  warnings: string[]
}
