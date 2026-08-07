import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { MedusaContainer } from "@medusajs/framework"
import { ImportOptions } from "./types"

/** Split an array into consecutive chunks of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

/** Distinct values, first-occurrence order preserved. */
export function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

/**
 * `query.graph` reads with an explicit skip/take loop.
 *
 * The store/admin routes apply a default limit; `query.graph` used directly
 * does not paginate for you, so anything that can exceed a few hundred rows
 * (inventory items, variants, option values) must be paged explicitly.
 */
export async function pagedGraph<T = Record<string, unknown>>(
  container: MedusaContainer,
  config: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    /**
     * Pricing/inventory context, e.g.
     * `{ variants: { calculated_price: QueryContext({ currency_code: "usd" }) } }`.
     * Without it `calculated_price` cannot be resolved.
     */
    context?: Record<string, unknown>
  },
  pageSize = 500
): Promise<T[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const out: T[] = []
  let skip = 0

  for (;;) {
    const { data, metadata } = await query.graph({
      ...config,
      pagination: { skip, take: pageSize },
    })

    out.push(...(data as T[]))

    const total = metadata?.count ?? data.length
    skip += pageSize
    if (out.length >= total || data.length === 0) {
      break
    }
  }

  return out
}

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
