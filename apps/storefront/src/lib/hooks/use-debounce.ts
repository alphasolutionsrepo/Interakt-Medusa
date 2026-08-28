"use client"

import { useEffect, useState } from "react"

/**
 * Returns `value` after it has stopped changing for `delay` ms.
 *
 * The storefront has no debounce utility and never imports `lodash`, despite it
 * being a dependency — so this is the local one.
 */
export function useDebounce<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}

export default useDebounce
