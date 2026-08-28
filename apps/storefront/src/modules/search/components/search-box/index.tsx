"use client"

import { autocompleteSuggestions } from "@lib/data/search"
import { useDebounce } from "@lib/hooks/use-debounce"
import { SearchSuggestion } from "@lib/interakt/types"
import { QUERY_PARAM } from "@lib/util/search-params"
import { MagnifyingGlass } from "@medusajs/icons"
import { clx } from "@modules/common/components/ui"
import { useParams, useRouter } from "next/navigation"
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react"

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 200

type SearchBoxProps = {
  /** Pre-fill, so the box on the results page shows the active query. */
  initialQuery?: string
  placeholder?: string
  autoFocus?: boolean
  className?: string
  /** Route segment a submit navigates to. Lets other search UIs (e.g. /search2) reuse this box. */
  basePath?: string
  "data-testid"?: string
}

const SearchBox = ({
  initialQuery = "",
  placeholder = "Search for jackets, denim, knitwear…",
  autoFocus = false,
  className,
  basePath = "search",
  "data-testid": dataTestId,
}: SearchBoxProps) => {
  const router = useRouter()
  const { countryCode } = useParams() as { countryCode: string }
  const [, startTransition] = useTransition()

  const [query, setQuery] = useState(initialQuery)
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * A server action cannot be aborted the way a `fetch` can, so cancellation is
   * done by sequence number: every request records its ordinal and any response
   * that is not the newest is discarded. Without this, a slow early keystroke
   * can land after a fast later one and show suggestions for a stale prefix.
   */
  const requestSeq = useRef(0)

  const listboxId = useId()
  const debouncedQuery = useDebounce(query, DEBOUNCE_MS)

  useEffect(() => {
    const trimmed = debouncedQuery.trim()

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([])
      return
    }

    const seq = ++requestSeq.current
    let cancelled = false

    autocompleteSuggestions(trimmed).then((next) => {
      if (cancelled || seq !== requestSeq.current) return
      setSuggestions(next)
    })

    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  // Close on click outside.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setIsOpen(false)
        setActiveIndex(-1)
      }
    }
    document.addEventListener("mousedown", onMouseDown)
    return () => document.removeEventListener("mousedown", onMouseDown)
  }, [])

  const submit = useCallback(
    (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) return

      setIsOpen(false)
      setActiveIndex(-1)
      inputRef.current?.blur()

      startTransition(() => {
        router.push(
          `/${countryCode}/${basePath}?${QUERY_PARAM}=${encodeURIComponent(trimmed)}`
        )
      })
    },
    [basePath, countryCode, router]
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setIsOpen(false)
      setActiveIndex(-1)
      return
    }

    if (!isOpen || suggestions.length === 0) return

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setActiveIndex((i) => (i < suggestions.length - 1 ? i + 1 : i))
        break
      case "ArrowUp":
        e.preventDefault()
        setActiveIndex((i) => (i > 0 ? i - 1 : -1))
        break
      case "Enter":
        // Nothing highlighted falls through to the form's native submit, which
        // searches exactly what was typed.
        if (activeIndex >= 0) {
          e.preventDefault()
          const picked = suggestions[activeIndex].text
          setQuery(picked)
          submit(picked)
        }
        break
    }
  }

  const showDropdown = isOpen && suggestions.length > 0

  return (
    <div ref={containerRef} className={clx("relative w-full", className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          submit(query)
        }}
      >
        <div
          className={clx(
            "flex items-center gap-3 h-12 w-full bg-white border border-ui-border-base pl-5 pr-2 transition-shadow",
            showDropdown ? "rounded-t-3xl rounded-b-none" : "rounded-full",
            "focus-within:shadow-elevation-card-hover"
          )}
        >
          <MagnifyingGlass className="text-ui-fg-muted shrink-0" />

          <input
            ref={inputRef}
            type="search"
            name={QUERY_PARAM}
            value={query}
            autoFocus={autoFocus}
            autoComplete="off"
            placeholder={placeholder}
            aria-label="Search products"
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
            }
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(-1)
              setIsOpen(true)
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={onKeyDown}
            data-testid={dataTestId}
            className="flex-1 h-full bg-transparent text-base-regular text-ui-fg-base placeholder:text-ui-fg-muted focus:outline-none [&::-webkit-search-cancel-button]:appearance-none"
          />

          <button
            type="submit"
            disabled={!query.trim()}
            className="shrink-0 h-9 px-5 rounded-full bg-black text-white text-small-regular transition-colors hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-black"
          >
            Search
          </button>
        </div>
      </form>

      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Search suggestions"
          className="absolute z-50 w-full bg-white border border-t-0 border-ui-border-base rounded-b-3xl overflow-hidden shadow-elevation-card-hover"
        >
          {suggestions.map((suggestion, i) => (
            <li key={suggestion.productId ?? suggestion.text} role="none">
              <button
                type="button"
                id={`${listboxId}-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                // `onMouseDown` rather than `onClick`: the input's blur would
                // otherwise close the dropdown before the click registers.
                onMouseDown={(e) => {
                  e.preventDefault()
                  setQuery(suggestion.text)
                  submit(suggestion.text)
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={clx(
                  "flex items-center gap-3 w-full px-5 py-3 text-left text-base-regular text-ui-fg-base transition-colors",
                  i === activeIndex ? "bg-ui-bg-subtle" : "bg-transparent"
                )}
              >
                <MagnifyingGlass className="text-ui-fg-muted shrink-0" />
                {/* Rendering `text`, not the server's `<mark>`-tagged
                    `highlight` — that would need sanitising before injection. */}
                <span className="truncate">{suggestion.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default SearchBox
