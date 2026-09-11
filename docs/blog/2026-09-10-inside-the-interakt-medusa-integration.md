---
title: "Inside the Interakt–Medusa Integration"
date: 2026-09-10
author: Alpha Solutions
description: "The architecture behind AI search and a conversational assistant on a Medusa storefront — how the catalog gets indexed, why search results come back through Medusa, and how we taught an assistant to drive a store that has no client-side tool calling."
tags: [Medusa, Interakt, architecture, AI search, streaming, Next.js]
---

We connected a Medusa 2 storefront to [Interakt](https://interakt.app/) — catalog indexing, AI
search, and a shopping assistant that can navigate the store and fill the cart. The
[overview post](./2026-09-10-ai-search-and-a-shopping-assistant-for-medusa.md) covers what it does,
and there are demo videos
(<!-- TODO: YouTube URL — search demo --> and <!-- TODO: YouTube URL — assistant / voice demo -->)
if you'd rather watch than read. This post is about how it's built, and about the decisions that
were less obvious than they looked.

## Two directions, two credentials

The cleanest way to hold this integration in your head is as two flows that happen to share an
index.

**Ingestion** goes up: Medusa pushes product documents into an Interakt Search Index, server to
server, using an ingestion key scoped to that index with write and delete permissions.
**Presentation** goes down: the storefront reads search results and chat responses using an access
token belonging to a specific Experience.

Interakt draws that line deliberately — the ingestion key is server-only, and the access token is
designed to be browser-safe so you can drop a widget on a page. We kept the access token
server-side anyway. Every call from our storefront goes through a server action or a Next.js route
handler, so the token never enters the JavaScript bundle and the Experience never needs a CORS
allowlist entry for our domain. That costs a proxy hop and buys a smaller blast radius.

## Getting the catalog out of Medusa

On the Medusa side this is a custom module wrapping an HTTP client, plus a set of workflows.

The module is deliberately dumb. It batches, retries, unwraps response envelopes, and knows
nothing about products — it moves documents. All product knowledge lives in the workflows and in a
single pure mapping function, so there's exactly one implementation of "what a product looks like
as a search document," shared by the script, the subscribers and the admin button.

Batching needed two ceilings rather than one, since the API caps document count *and* request
size: a thousand simple products fit comfortably, a thousand with large variant arrays do not. So
batches are cut on whichever limit is hit first, and an oversized document is still sent alone
rather than dropped — better a server error naming the limit than a product vanishing silently.

Two decisions here are worth more than the code they took.

**The subscribers swallow their errors.** The sync runs *after* the product save has already
committed. If Interakt is down and we let that exception propagate, an admin fixing a typo gets a
failed save and no idea why. So the subscriber logs instead, and the log line says what broke and
that a reindex repairs it. The cost is a briefly stale document — a much better failure than a
commerce backend that can't take edits because a search vendor is having a bad afternoon.

**Subscribers are the wrong tool for bulk imports.** Medusa emits one event per product, so
importing a catalog fires hundreds of them, each its own rate-limited API call. The client backs
off politely, but the honest guidance — which we put in the code comment rather than rediscovering
later — is that after a bulk import you run the full reindex, not the subscriber storm.

## Send raw documents, not computed ones

The instinct when building a search document is to precompute everything the UI might want:
minimum price, available colours, whether anything is in stock. That instinct is wrong here. The
index applies its own field-mapping rules server-side — deriving price ranges, availability
rollups and the vector source for semantic search itself. Sending precomputed versions doesn't
just duplicate work: the index has a collector field that absorbs unmapped keys into searchable
text, so a stray key isn't inert. It quietly becomes something customers can match against.

So the mapper emits a closed set of keys and lets the index derive the rest. The comment above it
is a list of things *not* to add — an odd shape for documentation that has already earned its keep.

## Search results come back through Medusa

This is the inversion that surprises people, and it's our favourite part of the design.

When a customer searches, Interakt returns ranked hits. We don't render them. We take the product
IDs out of those hits, fetch those products from Medusa, and render with the storefront's existing
product components. The index doesn't know today's price in the customer's region, and doesn't
know the product's URL handle. Medusa does. Hydrating through it gets us live region-aware pricing,
reuse of every product component we already had, and no new remote image hosts to allowlist.

There's a silent trap in it, though. Fetching by an array of IDs returns rows in database order —
throwing away the relevance ranking that was the entire point of searching. The results still look
fine. They're just no longer sorted by how well they matched. So after hydrating, we re-sort back
into the original hit order. Anything the index returned that Medusa no longer has is surfaced as
"no longer available" rather than silently dropped, so the result count never lies.

## Streaming, by hand

Both the AI summary and the chat are server-sent event streams, and neither uses `EventSource` —
these are POSTs carrying a body, which `EventSource` can't do. So the client issues a fetch, reads
the response body as a stream, splits on frame boundaries, keeps the trailing partial frame for
the next chunk, and dispatches on event type. Unknown types are ignored by design, so the backend
can add new ones without breaking a deployed storefront.

The two route handlers in front of these are thin: validate, attach the token, forward the abort
signal upstream, return the stream untouched with buffering disabled.

One of them is deliberately less thin. The summary route hardcodes its own instruction to the
model rather than accepting one from the client — otherwise a route carrying our credentials
becomes an open prompt endpoint running on our bill. Small line of code, easy thing to get wrong.

## Teaching the assistant to use the store

Here's the part we want to be precise about, because it would be easy to oversell.

Interakt's chat pipeline has no notion of client-side tools. It can search the index, reason about
what it found, and write a good answer — but it has no way to tell the browser to navigate
somewhere, and no access to the visitor's cart at all.

So we built a convention on top of it. The assistant's persona instructions tell it to end a reply
with a fenced block containing a small JSON action — open this product, run this filtered search,
add this SKU to the cart, go to checkout. The storefront parses those blocks out of the raw
streaming buffer (not the rendered text, so a fence split across two chunks still parses),
validates them against a schema, discards anything malformed without comment, de-duplicates so an
action can't fire twice across re-renders, then executes it through the storefront's own Medusa
server actions.

**This is our convention, not an Interakt feature.** Interakt never touches the cart. It suggests
an action; our code decides whether that action is valid and runs it. The model is untrusted input
at that boundary, and the schema is what stands between a hallucinated product ID and a broken
cart.

The other rough edge is memory. The chat API takes a message and a session ID and nothing else —
there's no history parameter. We carry the ID forward from each response, and, after seeing
continuity occasionally slip, also prepend a short recap of the previous exchange to each outgoing
message. Belt and braces, and cheap.

## Voice

Voice input is the Web Speech API — input only, no text-to-speech. The button hides itself
entirely where the browser doesn't support it, rather than offering something that won't work.

The nuance worth stealing: the microphone means different things in different places. In the
search box, speaking sets the query and submits immediately, because searching is cheap and
reversible. In the chat panel, speaking fills the input and waits for you to press send — because
a message you didn't mean to send is a conversation you now have to correct.

## What we'd revisit

The two search pages should converge once we've decided which layout wins; the facet logic is
duplicated between them on purpose, which is right for a comparison and wrong for a product.

And the action protocol is, honestly, a workaround. It works well, but the right long-term shape
is real client-side tool calling, where the assistant declares what it wants to do and the client
declares what it's allowed to do. We'd happily delete our fence parser the day that exists.

---

The reference implementation is public at
[alphasolutionsrepo/Interakt-Medusa](https://github.com/alphasolutionsrepo/Interakt-Medusa). If
you're doing something similar on Medusa, we'd genuinely like to compare notes —
<!-- TODO: LinkedIn URL — post 1 --> and <!-- TODO: LinkedIn URL — post 2 -->.
