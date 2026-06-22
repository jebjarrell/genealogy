# Deviations, assumptions, and resolved ambiguities

A running log of judgment calls made during implementation, for owner review.
Each entry notes what the TRD said, what was decided, and why.

## Phase ordering

- **TRD §0 / §12 reference "the phase order given in Section 12", but Section 12 is the
  testing strategy and does not enumerate numbered phases.** The prompt names "Phase 0
  (scaffold)". Resolved by deriving the natural build order forced by the dependency
  graph and the document's own section order, and logging it here rather than blocking:
  - **Phase 0** — scaffold: monorepo, tooling, portability lint rule, CI, README, the
    canonical types (§5), and the PlaceResolver interface.
  - **Phase 1** — GEDCOM parsing (§7): date / place / name sub-parsers (independent,
    parallelizable) then the adapter assembling the `GenealogyModel`; fixtures (§12.1).
  - **Phase 2** — graph construction + traversal + generations (§5.3, §6).
  - **Phase 3** — paths + pedigree collapse + common ancestors (the centerpiece; §6, §7.3).
  - **Phase 4** — relationship description (§9).
  - **Phase 5** — ego network + expand + focal heuristic + event sequence (§6).
  - **Phase 6** — `@genealogy/geo` resolvers (§8); parallelizable with Phases 2–5.
  - **Phase 7** — web app: React Flow adapter, panels, state, interactions (§10).
    Each phase is gated on the prior one's tests passing.

## Dependency versions

- **TRD §10.1 specifies "React 18 + Vite".** Honored React 18.3. The rest of the toolchain
  uses current stable majors that interoperate cleanly and were the maintained versions at
  build time: Vite 6, Vitest 3, TypeScript 5.9, ESLint 9 (flat config) + typescript-eslint
  8, Tailwind 3.4 (the well-trodden PostCSS setup; Tailwind 4's CSS-first config was a
  needless risk for an _optional_ styling tool), `@xyflow/react` 12, `@dagrejs/dagre` 3,
  Zustand 5. The absolute-latest of everything (Vite 8 / TS 6 / ESLint 10 / React 19 /
  Tailwind 4) was deliberately avoided to keep a coherent, low-friction matrix for a build
  whose core asset is a working, tested library.
- **GEDCOM parser:** `read-gedcom@0.3.2` (TRD §7.1's recommended default), verified current
  and maintained at build time.

## GEDCOM parser adapter

- **TRD §6 types `parseGedcom(input: string)`, but TRD §7.3 requires handling ANSEL
  encoding** — which is impossible once bytes have been decoded to a JS string. Resolved by
  widening the adapter to accept `string | ArrayBuffer | Uint8Array`. A `string` (the
  documented default) is encoded as UTF-8; raw bytes enable charset auto-detection
  (UTF-8 / ANSEL / etc.). The web app reads files as `ArrayBuffer` to get full encoding
  support. Honors the documented signature while satisfying the encoding requirement.
- **`read-gedcom` seam.** The library's high-level Selection DSL is not used. Instead the
  adapter calls its low-level `parseGedcom(buffer)` to get a normalized `TreeNode` tree
  (`{ tag, pointer, value, children }`) — letting the library own the genuinely hard parts
  (tokenization, encoding detection, CONT/CONC line continuation) — and walks that tree
  itself. This keeps the adapter self-contained and means the library's types never leak
  past `gedcom/parse.ts` (TRD §7.1). `read-gedcom`'s low-level parser can throw on
  malformed structure; the adapter catches and converts to a `ParseWarning`, never
  re-throwing (TRD §2, §7.3).

## Path enumeration & pedigree collapse (the centerpiece)

- **Relationship-path semantics.** The TRD says `enumeratePaths` returns "every distinct
  simple path … following the graph" but does not pin down what counts as a meaningful
  path. Treating the ancestor DAG as undirected would generate zig-zag artifacts (up to one
  parent, sideways via a shared child, back up) and explode combinatorially. Resolved by
  defining a genealogical relationship path as **Λ-shaped**: a monotonic ascent (child →
  parent) to an apex/common ancestor, then a monotonic descent (parent → child); once a
  path turns downward it never turns back up. Only parent/child edges are traversed
  (consanguineous paths); spouse edges are not. This yields exactly the meaningful distinct
  paths — including the reconverging paths of pedigree collapse — and bounds the search.
  Verified against `pedigree-collapse.ged`: exactly two paths to each collapse ancestor.
- **Truncation flag (TRD §6 vs §7.3).** §6 types `enumeratePaths` as returning `Path[]`,
  while §7.3 requires "a flag/warning that results were truncated." Resolved additively:
  the public `enumeratePaths` keeps the `Path[]` signature; an internal
  `enumerateRelationshipPaths` returns `{ paths, truncated }` (also exported), and
  `CollapsePoint` carries an optional `truncated` field. No documented signature changed.
- **Half-siblings** render as full siblings (`brother`/`sister`) — the §9 algorithm keys on
  generation distance to a common ancestor, not on how many parents are shared. Detecting
  half-relationships is beyond the documented English-kinship scope and is left for later.

## Web app (Phase 7)

- **Renderer adapter is pure.** `graphViewToFlow` (the only file that knows React Flow's
  shapes) is a pure function unit-tested without the DOM; dagre layout is a separate pass.
  Person-card display strings (lifespan, place) are computed in the node component from the
  store rather than baked into the adapter, keeping the adapter free of the model.
- **Spouse edges** are drawn but not fed to the dagre ranker (they connect same-generation
  peers); only `parentOf` edges drive the generational tiers. Nodes use a single top
  (target) / bottom (source) handle pair — enough for legible ancestry; per-side spouse
  handles were not worth the complexity in Step One.
- **Path highlighting expands the view.** When two people are compared, any person on a
  resulting path that isn't already visible is added to the view so the full path renders.
  Edge highlight keys are stored direction-agnostically (both orientations) and matched by
  the adapter against whichever oriented edge exists.
- **Node-budget behaviour.** Exceeding the 300-node budget on expand surfaces a notice but
  does not block the expansion (TRD §10.4 mandates a warning; blocking would be more
  disruptive than informative for a deliberate click). The initial ego network is hard-
  bounded by the budget.
- **Bundled sample.** A "Load sample" button imports `pedigree-collapse.ged` via Vite's
  `?raw` so the app is verifiable without sourcing a file; web tests load fixtures the same
  way (avoids Vite's `/@fs/` path prefix that breaks `import.meta.url`-based `fs` reads).

## Follow-on round — UX fixes & migration map

These were added after the owner reviewed the Step One viewer (see the approved plan).

- **Focal person is now chosen, not guessed.** On load: remembered choice
  (`localStorage`, per file) → declared home person → a picker modal. The youngest-leaf
  heuristic is only a _suggestion_ in the picker now.
- **Default graph view is "direct ancestors only".** Spouses/descendants/marriage edges are
  hidden by default (kills the step-relative + marriage-edge clutter the owner saw); a
  toolbar toggles them back. Implemented purely via existing `getEgoNetwork` options +
  display filtering — no core changes.
- **Migration map (Step Two, now built).** Scope agreed in planning: a _specific ancestral
  line's_ migration — pick focal + an ancestor, take that lineage (`enumeratePaths`), gather
  each person's located events (`extractEventSequence`), geocode, and animate by year with a
  time slider. Map renderer: **Leaflet + react-leaflet 4.2** (React-18 compatible; v5 needs
  React 19), with `CircleMarker`s (avoids Leaflet's bundler icon-asset pitfall) and a
  chronological polyline colored blue→red.
- **Geocoding privacy tradeoff (owner-accepted).** The map sends **place names** (never the
  file) to **OpenStreetMap Nominatim**, cached in `localStorage` so each place is fetched at
  most once. This relaxes the original "nothing leaves the machine" stance for the map only.
  Browser caveat: browsers forbid setting the `User-Agent` header, so the resolver's UA is
  dropped and Nominatim identifies the app via Origin/Referer; mitigated with a ≥1s rate
  limit and caching. The geocoder is a `createGeocoder({ fetchImpl, storage })` factory so
  tests inject a fake fetch + in-memory storage (no real network in CI).
- **Still read-only.** "Clear/reset" was added (clear selection/paths, reset view); actual
  data **editing (corrections + GEDCOM export)** remains scoped-but-unbuilt — its open
  question is faithful round-trip (retain the raw `read-gedcom` tree and patch it, since the
  library has no writer) vs. lossy export from our model. Deferred to its own phase.

## Phase-2 review round 1 — tree/map quick wins

Added after the owner used the migration map on a real file (see the approved plan,
"Round 1"). All localized to `apps/web` + small pure helpers in `@genealogy/core` and
`@genealogy/geo`; the read-only invariant is preserved (no editing yet).

- **Geocoding actually works on messy places now.** The map's "0 located events" and the
  profile "locate" failures shared one cause: real PLAC strings like
  `Fleming Co., KY, Kentucky, USA` don't match Nominatim verbatim. New pure
  `placeQueryCandidates` (`@genealogy/geo`) expands abbreviations (`Co.`→`County`), maps US
  state postal codes & country aliases (`KY`→`Kentucky`, `USA`→`United States`), drops the
  duplicated-state artifact, and emits progressively coarser fallbacks (full → drop
  most-specific → … → country). `NominatimResolver` tries each until a hit; an already-clean
  place still queries exactly as before (first candidate == joined hierarchy), so existing
  tests hold. The stale "Step One resolver is a no-op" label was removed — the resolver has
  been the real Nominatim chain since the map shipped.
- **Map default is now ALL ancestors' migration**, not a single line. New pure
  `allAncestorStops` aggregates `extractEventSequence` over `getAncestors(focal)`, deduping
  **shared events** (a marriage reachable from both spouses) by event id so each place plots
  once. Focusing a single line is still available ("focus a line…"). Bulk first-load is
  rate-limited (~1.1s/place) then cached forever.
- **Leaflet now re-measures on resize.** A `ResizeHandler` (ResizeObserver on the map
  container + window resize) calls `map.invalidateSize()`, fixing the stale canvas / blank
  gap when a side panel is collapsed.
- **Pedigree expansion is ancestors-only.** Double-click and the card **+** now expand
  `'ancestors'` (parents), not `'all'` — killing the children/spouse noise the owner saw.
  This also satisfies "extend ancestry from a given ancestor": **+** works on any node.
  A new **Siblings** toggle (core `getSiblings` = parents' children, incl. half-siblings)
  fans the view out to collaterals on demand; bounded by the node budget.
- **External research links (no API).** Pure `apps/web/src/research/links.ts` builds
  pre-filled searches: Ancestry (its `name=Given_Surname`, `birth=YEAR_Place-Hyphenated`
  packing), FamilySearch record search (`q.*` params, ±2yr date window). DAR's GRS search is
  a POST form that can't be deep-linked, so the DAR link is a site-scoped web search
  (`site:services.dar.org <name>`) — reliable prefill without guessing their form params.

## Phase-2 review round 2 — profile sketch, Family analytics, geocoding fallback

Built after Round 1 merged; UX confirmed with the owner. Pure logic lives in
`@genealogy/core` (firewall-safe); rendering and network in `apps/web`/`@genealogy/geo`.
The viewer stays read-only.

- **FamilySearch-style profile bio sketch (#9).** New pure `personSketch`
  (`packages/core/src/profile/sketch.ts`) summarises birth, death (+ age), spouse(s),
  child count, and military service. The detail panel renders it at the top and — per the
  owner's choice — **keeps the full events / relationships / sources lists below it**
  (nothing hidden). "Spouse"/"Children" appear both in the sketch and the detailed lists by
  design.
- **Military detection is explicit-only (owner's choice).** New `packages/core/src/military/
  wars.ts`: `WAR_ERAS` + `classifyWar(year)` + `militaryServiceOf(model, id)`. Service is
  flagged only from GEDCOM military events (`MILI`/`_MILT` → `type: 'military'`), and the war
  is keyed off the event's year — no inference from lifespan overlap (accuracy over breadth).
- **"Family" analytics tab (#11).** New pure `computeFamilyStats`
  (`packages/core/src/analytics/family-stats.ts`) over the focal person's **direct ancestors**
  (chosen scope): ancestor count + max generation (headline), longevity (avg/median of known
  birth→death), most common birth region (a `regionOf` that drops a trailing country token so
  "City, State, Country" → State), average children per ancestral couple, and military service
  by war. A new "Family" top-tab (beside Graph/Map) renders it; Review stays for Round 3.
- **Geocoding fallback + fast-fail (folded in from the deferred Round 1 issue).** Round 1's
  query cleanup was correct, but the public OSM Nominatim can still block/rate-limit the
  browser. Added **`PhotonResolver`** (`packages/geo/src/photon.ts`) — komoot's CORS-friendly,
  no-User-Agent OSM geocoder — as a fallback after Nominatim in the caching chain. Resolvers
  now distinguish a **miss** (200 + no result → coarsen the query) from a **provider error**
  (HTTP/network → stop and let the fallback run), via a shared `QueryResult` type, so a
  blocked Nominatim hands off to Photon quickly instead of wading through every candidate.
  `PlaceResolutionSource` gains `'photon'`. (Couldn't live-verify here — the sandbox has no
  geocoder egress — but it's unit-tested with injected fetch; real verification is in-browser.)
- **Root cause of the geocoding failure (found post-merge).** The reason geocoding produced
  zero results in the browser — through both Round 1 and the Photon work — was not the query
  strings or the service: the resolvers stored the global `fetch` as an object property
  (`this.fetchImpl = options.fetchImpl ?? fetch`) and called it as `this.fetchImpl(...)`.
  Native `fetch` must be invoked with `this === window`/`globalThis`; called as a method of
  another object the browser throws `TypeError: Illegal invocation`, which the resolvers'
  try/catch swallowed → `null` from every provider. Unit tests never caught it because they
  always inject a plain `fetch`. Fixed with `globalFetch()` (`packages/geo/src/fetch.ts`),
  which binds the global fetch; both resolvers use it, and a regression test stubs
  `globalThis.fetch` with a strict-`this` function to reproduce the browser behaviour.

## Portability lint rule

- Implemented with core ESLint rules (`no-restricted-imports` + `no-restricted-globals`)
  rather than an extra plugin, to minimize flat-config compatibility risk. Forbids Node
  built-ins (bare + `node:` prefixed), rendering/framework libraries, and DOM/network/Node
  globals (`window`, `document`, `fetch`, `process`, ...) inside `packages/core/src/**`.
  `gedcom/parse.ts` is the single sanctioned exception allowed to import `read-gedcom`.
  Verified by a probe file that produced 9 lint errors, then removed.
