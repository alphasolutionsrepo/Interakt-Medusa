# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read [AGENTS.md](./AGENTS.md) — it holds this project's directory structure, code style, conventions, and off-limits paths. Follow it for all work in this repository. This file records what AGENTS.md leaves generic or states incorrectly for *this* checkout, plus the architecture.

## Resolved facts for this checkout

AGENTS.md asks you to detect these. They are already settled — don't re-derive them:

- **Package manager is yarn 4.9.2** (`packageManager` in [package.json](package.json), `yarn.lock`, `nodeLinker: node-modules`). Never introduce a second lockfile.
- **`apps/storefront` exists.** This is a full-stack checkout, so the "storefront is optional, check first" caveat doesn't apply.
- Medusa and all `@medusajs/*` packages are pinned to **2.18.0**. Backend runs React 18; storefront runs React 19 (pinned via a root `pnpm.overrides` block that yarn ignores — the storefront pins `@types/react` itself).
- **The repo has no commits yet** (`main` is unborn), so there is no git history to consult for intent.

## Commands AGENTS.md gets wrong

Two documented commands are no-ops or failures because the backend package has no such script (its scripts are only `build`, `start`, `dev`, `lint`, `test:integration:http`, `test:integration:modules`, `test:unit`):

- `yarn test` / `turbo test` — **no `test` script exists in either app.** Run a specific suite from `apps/backend` instead (`yarn test:unit`, `yarn test:integration:modules`, `yarn test:integration:http`). Each sets `TEST_TYPE`, which [jest.config.js](apps/backend/jest.config.js) reads to pick `testMatch` — so keep `TEST_TYPE` when passing a path or `-t` through to Jest.
- `yarn backend:seed` — **no `seed` script exists.** The seed is a Medusa migration script with a `default export ({ container })` at [initial-data-seed.ts](apps/backend/src/migration-scripts/initial-data-seed.ts); run it from `apps/backend` with `yarn exec medusa exec ./src/migration-scripts/initial-data-seed.ts` (or `medusa db:migrate:scripts` for all migration scripts).

Everything else in AGENTS.md's command list is accurate; `medusa lint`, `medusa db:generate`, `medusa db:migrate`, and `medusa user` are all real subcommands of the pinned CLI.

## Architecture

### Backend (`apps/backend`) is an unmodified starter

`src/` contains only README stubs plus two placeholder routes (`api/store/custom`, `api/admin/custom`) and the seed script. There are **no custom modules, workflows, links, subscribers, or jobs yet** — so there is no existing in-repo pattern to copy for those. Follow the `medusa-dev` skills (see AGENTS.md) when adding the first one.

[medusa-config.ts](apps/backend/medusa-config.ts) is minimal: database URL, the three CORS vars, and JWT/cookie secrets. **No modules array and no Redis/cache/event-bus modules are configured**, despite `REDIS_URL` appearing in `.env.template` — so the project runs on in-memory defaults. Registering a module means adding it here. OpenTelemetry exists but is fully commented out in `instrumentation.ts`.

### Storefront (`apps/storefront`) holds all the real code

Next.js 15 App Router, React 19, Tailwind with `@medusajs/ui-preset`, dev/start on port **8000**. Path aliases: `@lib/*` and `@modules/*` (`baseUrl: ./src`).

**Two-directory split — `app/` routes, `modules/` UI.** `src/app/` files stay thin: resolve params, fetch data, render a template. All markup lives in `src/modules/<domain>/`, each with `templates/` (page-level composition) and `components/` (pieces). A new page should add a route under `app/` and put its UI in the matching `modules/` domain rather than growing the route file.

**Every route is country-scoped: `app/[countryCode]/...`.** [middleware.ts](apps/storefront/src/middleware.ts) is the entry point for this — it fetches `/store/regions` into a module-level 1-hour region-map cache, resolves a country from (in order) the URL segment, Cloudflare `request.cf.country`, Vercel `x-vercel-ip-country`, then `NEXT_PUBLIC_DEFAULT_REGION`, and **307-redirects any URL missing a valid country prefix**. It also mints the `_medusa_cache_id` cookie. Consequences:

- Product/region data can't be fetched without a `countryCode` or `regionId` — `listProducts` throws without one, since prices are region-scoped.
- Never hardcode an internal `href`. Use `LocalizedClientLink` ([localized-client-link](apps/storefront/src/modules/common/components/localized-client-link/index.tsx)), which reads `countryCode` from `useParams()` and prefixes it.
- Middleware runs on Edge, so it uses raw `fetch` rather than the JS SDK.

**Data layer: `src/lib/data/*` are `"use server"` server actions, one file per domain** (cart, customer, products, regions, orders, payment, fulfillment, …). This is the only place the backend is called; components import these, never `sdk` directly. Each function follows the same shape:

1. `getAuthHeaders()` — reads the `_medusa_jwt` cookie into an `authorization` header.
2. `getCacheOptions("<tag>")` — builds `{ tags: ["<tag>-<_medusa_cache_id>"] }`, then reads use `cache: "force-cache"` with those tags.
3. After any mutation, `revalidateTag(await getCacheTag("<tag>"))` — often several tags (e.g. `updateCart` invalidates both `carts` and `fulfillment`).
4. Errors go through `medusaError` ([medusa-error.ts](apps/storefront/src/lib/util/medusa-error.ts)).

Cache tags are **per-visitor**, namespaced by the `_medusa_cache_id` cookie — that's why revalidation must go through `getCacheTag` instead of a bare string, and why cookie helpers live in the `"server-only"` [cookies.ts](apps/storefront/src/lib/data/cookies.ts).

**Auth and cart identity are httpOnly cookies, not client state**: `_medusa_jwt`, `_medusa_cart_id`, `_medusa_locale`, `_medusa_cache_id`, plus `_medusa_pending_customer` — which exists because email-verification signup can't create the customer until after verification, so extra signup fields are parked in a cookie meanwhile.

**Locale support is wired through the SDK, not a routing i18n library.** [config.ts](apps/storefront/src/lib/config.ts) monkey-patches `sdk.client.fetch` to inject an `x-medusa-locale` header from the locale cookie on *every* request. `updateLocale` also pushes the locale onto the cart and revalidates products/categories/collections. `listLocales` calls `/store/locales` and **swallows 404 into `null`** — that endpoint is not part of the stock backend and doesn't exist in `apps/backend`, so treat locale UI as degrading gracefully rather than guaranteed.

**Account uses parallel routes.** `account/@dashboard` and `account/@login` are slots; `account/layout.tsx` fetches the customer and renders one or the other. Add authenticated account pages under `@dashboard`.

## Gotchas beyond AGENTS.md's list

- **The storefront build hides type and lint errors.** [next.config.js](apps/storefront/next.config.js) sets both `typescript.ignoreBuildErrors` and `eslint.ignoreDuringBuilds`, so a green `yarn build` proves nothing about types. Verify with `yarn exec tsc --noEmit` and `yarn lint` in `apps/storefront`.
- `next.config.js` calls `check-env-variables.js`, which **`process.exit(1)`s** when `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` is absent — a missing key kills dev/build immediately rather than failing at request time.
- Images are `unoptimized: true` with an allowlist of remote patterns; a new image host must be added to `remotePatterns`.
- The two apps disagree on formatting config (storefront has its own `.prettierrc.json` with `semi: false` and its own legacy `.eslintrc.json` extending `next/core-web-vitals`, while the root uses flat-config `@medusajs/eslint-plugin`). Match the app you're editing.
- `apps/storefront/tsconfig.tsbuildinfo` (580KB of build cache) sits in the working tree and is **not** covered by `.gitignore` — don't treat it as a source file, and keep it out of the first commit.
