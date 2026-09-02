import { addToCart, retrieveCart } from "@lib/data/cart"
import { listProducts } from "@lib/data/products"
import { ChatAction } from "./actions"

/** Duck-typed against next/navigation's router — avoids depending on its internal type. */
type Navigator = { push: (href: string) => void }

type ExecuteContext = {
  router: Navigator
  countryCode: string
  /** Route segment for navigate_search — "search" or "search2", matching whichever page hosts this chat. */
  basePath: string
}

/**
 * Runs one action the assistant asked for and returns a short human-readable
 * note describing what happened (rendered under the assistant's message), or
 * null if the action type is unrecognized.
 *
 * Reuses the exact same server actions the rest of the storefront uses for
 * these operations (`listProducts`, `addToCart`, `retrieveCart`) — Interakt
 * never touches the cart; it only suggested this action.
 */
export async function executeChatAction(
  action: ChatAction,
  { router, countryCode, basePath }: ExecuteContext
): Promise<string | null> {
  switch (action.type) {
    case "navigate_product": {
      const { response } = await listProducts({
        countryCode,
        queryParams: { id: [action.productId], fields: "handle", limit: 1 },
      })
      const product = response.products[0]
      if (!product?.handle) {
        return "Hmm, couldn't find that product."
      }
      router.push(`/${countryCode}/products/${product.handle}`)
      return "👗 Opening product page"
    }

    case "navigate_search": {
      const params = new URLSearchParams()
      params.set("q", action.query)
      if (action.filters) {
        for (const [field, value] of Object.entries(action.filters)) {
          for (const v of Array.isArray(value) ? value : [value]) {
            params.append(`f_${field}`, v)
          }
        }
      }
      router.push(`/${countryCode}/${basePath}?${params.toString()}`)
      return "🔍 Updated your search"
    }

    case "add_to_cart": {
      const { response } = await listProducts({
        countryCode,
        queryParams: {
          id: [action.productId],
          fields: "*variants,+variants.inventory_quantity",
          limit: 1,
        },
      })
      const variants = response.products[0]?.variants ?? []
      if (!variants.length) {
        return "Hmm, couldn't find that product to add it."
      }

      const variant =
        (action.sku && variants.find((v) => v.sku === action.sku)) ||
        (variants.length === 1 ? variants[0] : undefined) ||
        variants.find((v) => (v.inventory_quantity ?? 0) > 0) ||
        variants[0]

      if (!variant?.id) {
        return "Hmm, couldn't add that to your cart."
      }

      try {
        await addToCart({
          variantId: variant.id,
          quantity: action.quantity ?? 1,
          countryCode,
        })
        return "📦 Added to your cart"
      } catch {
        return "Couldn't add that to your cart — please try from the product page."
      }
    }

    case "navigate_checkout": {
      const cart = await retrieveCart()
      if (!cart?.items?.length) {
        return "Your cart's empty — want help finding something first?"
      }
      router.push(`/${countryCode}/checkout`)
      return "🧾 Opening checkout"
    }

    default:
      return null
  }
}
