import { MedusaError } from "@medusajs/framework/utils"
import {
  ApiEnvelope,
  DocumentWriteOperation,
  GetDocumentResponse,
  IndexDocumentsResponse,
  IndexingError,
  LoadResult,
  SearchIndexOptions,
  WriteDocumentsResponse,
  WriteError,
  WriteResult,
} from "./types"

/**
 * HTTP client for Interakt's document-indexing API.
 *
 * Deliberately dumb: it batches, retries and unwraps envelopes, and knows
 * nothing about products. Document building lives in
 * `src/workflows/search-indexing/document.ts`, and every caller reaches this
 * service through a workflow rather than resolving it directly.
 *
 * Two write paths, because Interakt has two:
 *   - `loadDocuments`  POST /documents       full (re)load, provisions the index,
 *                                            records a batch, 30 req/min
 *   - `writeDocuments` POST /documents/bulk  incremental add/update/delete,
 *                                            index must exist, 60 req/min
 * Both upsert on the index's mapped `uniqueId` (our `productId`), so re-sending
 * a document updates it in place rather than duplicating it.
 */

/** Interakt rejects a body over 10MB, and over 10k documents. Stay clear of both. */
const MAX_DOCUMENTS_PER_REQUEST = 1000
const MAX_BYTES_PER_REQUEST = 8 * 1024 * 1024

const MAX_ATTEMPTS = 3
const REQUEST_TIMEOUT_MS = 60_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Split into requests that satisfy BOTH ceilings.
 *
 * Not `chunk()` from the import helpers: a fixed count is not enough on its own,
 * because document size varies with variant count — 1000 small products fit
 * comfortably while 1000 large ones would not. A single oversized document is
 * still emitted alone rather than dropped, so the server rejects it with a
 * message naming the limit instead of it vanishing silently.
 */
function batchBySizeAndCount<T>(items: T[]): T[][] {
  const batches: T[][] = []
  let current: T[] = []
  let bytes = 0

  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item))

    if (
      current.length > 0 &&
      (current.length >= MAX_DOCUMENTS_PER_REQUEST ||
        bytes + size > MAX_BYTES_PER_REQUEST)
    ) {
      batches.push(current)
      current = []
      bytes = 0
    }

    current.push(item)
    bytes += size
  }

  if (current.length) {
    batches.push(current)
  }

  return batches
}

export default class SearchIndexClientService {
  private readonly options_: SearchIndexOptions

  constructor(_: unknown, options: SearchIndexOptions = {}) {
    this.options_ = options
  }

  /**
   * The currency documents are priced in.
   *
   * Lives here rather than in the reindex script so the CLI and the event
   * subscribers cannot disagree about it — a document built in one currency and
   * upserted over one built in another would silently corrupt prices.
   */
  get currency(): string {
    return this.options_.currency ?? "usd"
  }

  /** Whether credentials are present, without throwing. */
  get isConfigured(): boolean {
    return !!(this.options_.indexId && this.options_.apiKey)
  }

  /**
   * Resolve credentials, or explain precisely what is missing.
   *
   * Called per request rather than in the constructor on purpose: this module is
   * constructed on every backend boot, and `yarn reindex dry-run` — the first
   * step of setting Interakt up — has to work on a machine that has no key yet.
   */
  private config_(): { baseUrl: string; indexId: string; apiKey: string } {
    const missing: string[] = []
    if (!this.options_.indexId) missing.push("SEARCH_INDEX_ID")
    if (!this.options_.apiKey) missing.push("SEARCH_INDEX_API_KEY")

    if (missing.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        `Search index is not configured: ${missing.join(" and ")} ` +
          `${missing.length > 1 ? "are" : "is"} missing from apps/backend/.env.\n` +
          "  SEARCH_INDEX_ID is the index UUID — take it from the interakt UI, from\n" +
          "  the URL of the medusa-products index page. It cannot be looked up by\n" +
          "  name over the API: interakt's middleware only exempts the /documents\n" +
          "  subtree from session auth, so every other route needs a browser login."
      )
    }

    return {
      baseUrl: (this.options_.baseUrl ?? "http://localhost:3000").replace(/\/$/, ""),
      indexId: this.options_.indexId!,
      apiKey: this.options_.apiKey!,
    }
  }

  /**
   * One authenticated request, retried on 429 and 5xx.
   *
   * 4xx other than 429 is not retried — a malformed document or a revoked key
   * fails the same way every time, and retrying only delays the error.
   */
  private async request_<T>(
    path: string,
    init: { method: string; body?: unknown }
  ): Promise<T> {
    const { baseUrl, indexId, apiKey } = this.config_()
    const url = `${baseUrl}/api/search-indexes/${indexId}${path}`

    let lastError: Error | undefined

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let response: Response

      try {
        response = await fetch(url, {
          method: init.method,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch (e) {
        // Network failure or timeout — worth another go.
        lastError = e as Error
        if (attempt < MAX_ATTEMPTS) {
          await sleep(2 ** attempt * 500)
          continue
        }
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Search index request failed: ${init.method} ${url} — ${lastError.message}`
        )
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt < MAX_ATTEMPTS) {
          // Interakt rate-limits per ingestion key, so a busy CLI run and a burst
          // of subscribers contend for the same budget. Prefer its Retry-After.
          const retryAfter = Number(response.headers.get("retry-after"))
          await sleep(
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : 2 ** attempt * 500
          )
          continue
        }
      }

      const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null

      if (!response.ok || !payload || payload.success === false) {
        const detail =
          payload && payload.success === false ? payload.error : response.statusText
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Search index request failed (${response.status}): ${init.method} ${url} — ${detail}`
        )
      }

      return payload.data
    }

    /* c8 ignore next */
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Search index request exhausted retries: ${init.method} ${url}`
    )
  }

  /**
   * Full (re)load. Provisions the index if it does not exist yet.
   *
   * Upsert, not replace: documents already in the index that are absent from
   * `documents` are left alone. Removing them is the caller's job.
   */
  async loadDocuments(
    documents: Record<string, unknown>[],
    sourceFileName?: string
  ): Promise<LoadResult> {
    const result: LoadResult = {
      success: true,
      batchIds: [],
      summary: { total: 0, indexed: 0, failed: 0 },
      errors: [],
      warnings: [],
    }

    if (!documents.length) {
      return result
    }

    for (const batch of batchBySizeAndCount(documents)) {
      const data = await this.request_<IndexDocumentsResponse>("/documents", {
        method: "POST",
        body: { documents: batch, sourceFileName },
      })

      result.batchIds.push(data.batchId)
      result.summary.total += data.summary.total
      result.summary.indexed += data.summary.indexed
      result.summary.failed += data.summary.failed
      result.errors.push(...(data.errors ?? ([] as IndexingError[])))
      result.warnings.push(...(data.warnings ?? []))
      result.success &&= data.success
    }

    return result
  }

  /** Incremental add/update/delete. The index must already exist. */
  async writeDocuments(
    operations: DocumentWriteOperation[]
  ): Promise<WriteResult> {
    const result: WriteResult = {
      success: true,
      summary: {
        total: 0,
        succeeded: 0,
        failed: 0,
        counts: { upload: 0, merge: 0, delete: 0 },
      },
      errors: [],
      warnings: [],
    }

    if (!operations.length) {
      return result
    }

    for (const batch of batchBySizeAndCount(operations)) {
      const data = await this.request_<WriteDocumentsResponse>("/documents/bulk", {
        method: "POST",
        body: { operations: batch },
      })

      result.summary.total += data.summary.total
      result.summary.succeeded += data.summary.succeeded
      result.summary.failed += data.summary.failed
      result.summary.counts.upload += data.summary.counts.upload
      result.summary.counts.merge += data.summary.counts.merge
      result.summary.counts.delete += data.summary.counts.delete
      result.errors.push(...(data.errors ?? ([] as WriteError[])))
      result.warnings.push(...(data.warnings ?? []))
      result.success &&= data.success
    }

    return result
  }

  /**
   * Read one document, or `null` if it is not indexed.
   *
   * Used to snapshot state before an incremental write so the step can roll
   * back. A 404 is an expected answer here, not a failure.
   */
  async readDocument(documentId: string): Promise<Record<string, unknown> | null> {
    try {
      const data = await this.request_<GetDocumentResponse>(
        `/documents/${encodeURIComponent(documentId)}`,
        { method: "GET" }
      )
      return data.document
    } catch (e) {
      if (e instanceof MedusaError && /\(404\)/.test(e.message)) {
        return null
      }
      throw e
    }
  }
}
