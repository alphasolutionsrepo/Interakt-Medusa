import { MedusaError } from "@medusajs/framework/utils"
import { ImportOptions } from "./types"

/**
 * `chunk`, `unique` and `pagedGraph` moved to `src/utils/query.ts` so the
 * search-indexing workflow steps can share them without importing from a
 * script. Re-exported here so the importer's call sites stay unchanged.
 */
export { chunk, unique, pagedGraph } from "../../utils/query"

/**
 * Throw a contextual error instead of letting an `undefined` id travel into a
 * workflow, where it surfaces as an opaque failure several steps deep.
 */
export function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Import aborted: ${what}`)
  }
  return value
}

/**
 * Parse the script's arguments.
 *
 * `medusa exec` declares `[args..]` as a variadic POSITIONAL, and its yargs
 * parser rejects unknown `--flags` before they ever reach us. So flags are
 * passed bare — `yarn seed dry-run limit=5` — and a leading `--` is tolerated
 * for anyone who types it out of habit.
 */
export function parseOptions(args: string[]): ImportOptions {
  const tokens = (args ?? []).map((a) => a.replace(/^--/, ""))

  const flag = (name: string) => tokens.includes(name)
  const value = (name: string) => {
    const withEquals = tokens.find((a) => a.startsWith(`${name}=`))
    if (withEquals) {
      return withEquals.slice(name.length + 1)
    }
    const at = tokens.indexOf(name)
    return at !== -1 ? tokens[at + 1] : undefined
  }

  const limit = value("limit")
  const chunkSize = value("chunk-size")
  const only = value("only")

  return {
    dryRun: flag("dry-run"),
    limit: limit ? Number(limit) : undefined,
    chunkSize: chunkSize ? Number(chunkSize) : 20,
    only: only ? new Set(only.split(",").map((s) => s.trim())) : undefined,
    hideDemoData: flag("hide-demo-data"),
    verbose: flag("verbose"),
  }
}

/** Human-readable elapsed time for the run summary. */
export function since(start: number): string {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`
}
