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

## Portability lint rule

- Implemented with core ESLint rules (`no-restricted-imports` + `no-restricted-globals`)
  rather than an extra plugin, to minimize flat-config compatibility risk. Forbids Node
  built-ins (bare + `node:` prefixed), rendering/framework libraries, and DOM/network/Node
  globals (`window`, `document`, `fetch`, `process`, ...) inside `packages/core/src/**`.
  `gedcom/parse.ts` is the single sanctioned exception allowed to import `read-gedcom`.
  Verified by a probe file that produced 9 lint errors, then removed.
