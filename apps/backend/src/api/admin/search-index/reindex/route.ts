import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SEARCH_INDEX_MODULE } from "../../../../modules/search-index"
import SearchIndexClientService from "../../../../modules/search-index/service"
import { reindexSearchWorkflow } from "../../../../workflows/search-indexing/reindex-search"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const searchIndex = req.scope.resolve<SearchIndexClientService>(
    SEARCH_INDEX_MODULE
  )

  if (!searchIndex.isConfigured) {
    res.status(400).json({
      message:
        "Interakt search index is not configured (SEARCH_INDEX_ID / SEARCH_INDEX_API_KEY missing).",
    })
    return
  }

  const { result } = await reindexSearchWorkflow(req.scope).run({
    input: { sourceFileName: "admin-push-all" },
  })

  const load = result.load

  res.json({
    productsBuilt: result.documents.length,
    warnings: result.warnings.length,
    load: load
      ? {
          success: load.success,
          total: load.summary.total,
          indexed: load.summary.indexed,
          failed: load.summary.failed,
          errors: load.errors.length,
        }
      : null,
  })
}
