import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MedusaContainer } from "@medusajs/framework"

/**
 * Shared `query.graph` helpers.
 *
 * These live here rather than under `src/scripts/` because both the catalogue
 * CLI and the search-indexing workflow steps need them, and a workflow must not
 * import from a script — scripts are entry points run by `medusa exec`, and
 * depending on one from code that also runs inside the server process gets the
 * dependency direction backwards.
 */

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
