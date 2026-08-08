import { Module } from "@medusajs/framework/utils"
import SearchIndexClientService from "./service"

/**
 * Container key. camelCase is mandatory — a dashed module name is a runtime
 * resolution error in Medusa 2.x, not a lint preference.
 */
export const SEARCH_INDEX_MODULE = "searchIndex"

export default Module(SEARCH_INDEX_MODULE, {
  service: SearchIndexClientService,
})

export { default as SearchIndexClientService } from "./service"
export * from "./types"
