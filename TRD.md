# Technical Requirements Document — Genealogy Knowledge Graph Viewer

**Version:** 1.0
**Date:** June 20, 2026
**Status:** Ready for implementation
**Audience:** Claude Code (implementation agent)
**Owner:** Jeb Jarrell

---

## 0. How to use this document

This is the build specification for a local, interactive tool that turns a GEDCOM family-tree file into an explorable knowledge graph. It is written to be handed directly to an implementation agent. Build it in the phase order given in Section 12; each phase has explicit acceptance criteria and is independently verifiable.

Two rules govern every decision below and should not be violated even where this document is silent:

1. **The core library is UI-agnostic and network-agnostic.** It is pure TypeScript: no DOM, no `fetch`, no Node-only APIs, no rendering-library imports. Everything that touches the screen or the network lives in another package. This is the single most important architectural constraint; it is what preserves the option to later run the same logic server-side or behind a different UI without a rewrite.
2. **Raw source data is preserved; normalization is additive.** Every normalized field (name, date, place) keeps the original string alongside it. Parsing never discards what the file said.

---

## 1. Purpose and scope

### 1.1 What this is

A desktop-browser tool that loads a GEDCOM file (the standard genealogy export format, produced by Ancestry, FamilySearch, MyHeritage, RootsMagic, etc.), parses it into a normalized in-memory model, and renders an interactive graph the user can explore. The defining capability — the thing tree-viewer software fundamentally cannot do — is showing **multiple distinct relationship paths between the same two people** (pedigree collapse): the different ways a single ancestor is related to you.

### 1.2 In scope (this build — "Step One")

- Loading and parsing a GEDCOM file entirely client-side.
- A normalized data model (people, families, events, places) with provenance and uncertainty preserved.
- Graph construction and the analysis primitives: ancestor/descendant traversal, generation numbering, all-paths enumeration, pedigree-collapse detection, common-ancestor finding, and relationship description.
- An interactive, ego-centric graph view (focal person + N generations, expandable on click) with a person detail panel and search.
- The pedigree-collapse feature surfaced visually and as a report.
- A `PlaceResolver` **interface** and a caching design (defined and stubbed now), so Step Two slots in without refactoring.

### 1.3 Out of scope (explicit non-goals)

These are deliberately excluded. Do not build them, and do not add architecture in anticipation of them beyond the seams named in this document.

- **The migration map itself.** The data plumbing that feeds it (located-event sequences, the resolver interface) is in scope; the map renderer is Step Two.
- No backend, server, database, authentication, or multi-user anything. The model lives in memory, built from one loaded file.
- No writing back to GEDCOM, FamilySearch, or any source. This is a **read-only viewer**; it never edits the tree.
- No live FamilySearch/Ancestry API calls in this build. (FamilySearch Places is a future resolver implementation behind the interface; Ancestry is never automated.)
- No book/OCR mining, no multi-source identity resolution, no same-as merging. The input is a single trusted GEDCOM; person identity is the file's xref ID. (This scopes out the hardest problem in genealogy data and is intentional.)
- No AI content generation, video, narration, children's books, or any consumer-product surface.
- No mobile apps. Desktop browser only.

### 1.4 Relationship to prior work

The data model in Section 5 is adapted from an existing schema (the "StoryTree" architecture document) that already worked out the right shape — accuracy enums on dates, events as first-class entities, places as a resolvable cache. We keep that and drop everything that existed only to serve a multi-tenant SaaS (`tree_id`, `user_id`, partition keys, stored `generation`). Generation is relative to a focal person and is therefore computed, never stored.

---

## 2. Functional requirements

1. The user loads a `.ged` file via a file picker in the browser. Parsing happens locally; the file never leaves the machine.
2. Malformed or dialect-variant GEDCOM is parsed as far as possible. Problems are collected as warnings and surfaced, not thrown as fatal errors. A partially-readable file still produces a usable graph.
3. The tool identifies a **focal person** (default heuristic, user-overridable) around whom generations are numbered and the ego network is centered.
4. The user sees an ego-centric graph: the focal person plus a bounded number of ancestor generations by default, with the option to include descendants and collateral lines.
5. Clicking a person opens a detail panel showing their names, events (with dates and places), source citations, and immediate relationships — each with the raw source string available.
6. The user can expand the graph by clicking a person to reveal their not-yet-shown neighbors (parents, children, spouses), subject to a node budget with a warning before large expansions.
7. The user can search for any person by name and set them as the focal person.
8. The user can select two people and see every distinct relationship path between them, with each path described in relationship terms.
9. The tool detects pedigree collapse from the focal person and marks collapse points in the graph, lists them in a report, and describes the multiple relationships each implies.
10. All graph analysis (paths, generations, common ancestors, collapse) is performed in the core library as pure functions, independent of rendering.

---

## 3. Non-functional requirements

Because this is a single-user local tool, the usual distributed-systems concerns (horizontal scaling, failover, availability SLAs) do not apply. The non-functional requirements that *do* matter:

- **Determinism.** Parsing and graph construction produce identical output for identical input, with stable ordering. This is required for stable tests and reproducible renders.
- **Performance.** Parsing and all graph operations must handle trees up to ~10,000 individuals comfortably in-browser (the target real-world tree is in the hundreds). Path enumeration must guard against pathological blow-up (see Section 7.3). Rendering is bounded by a node budget, not by tree size.
- **Legibility over completeness in the view.** The renderer never attempts to draw the whole tree at once by default; an unbounded force-directed graph of thousands of nodes is an unreadable hairball and is explicitly rejected. Boundedness (ego network + on-demand expansion) is the design, not a fallback.
- **Portability of the core.** The core library must run unchanged in a browser today and in Node tomorrow. Enforced by the no-DOM/no-network rule and verified by running the core test suite in a Node environment.
- **Maintainability.** Third-party parsers and rendering libraries are wrapped behind our own adapters and types so the codebase never couples directly to a specific library's AST or component API.

---

## 4. High-level architecture

### 4.1 Component diagram

```
                          ┌─────────────────────────────────────────┐
                          │            apps/web (browser)            │
                          │                                          │
  .ged file ──picker────▶ │  upload → calls core.parseGedcom()       │
                          │                                          │
                          │  ┌────────────────────────────────────┐  │
                          │  │ React Flow renderer (adapter layer) │  │
                          │  │  - ego network → nodes/edges        │  │
                          │  │  - dagre layout by generation rank  │  │
                          │  │  - detail panel, search, controls   │  │
                          │  │  - pedigree-collapse highlighting   │  │
                          │  └────────────────────────────────────┘  │
                          │            │ injects                      │
                          │            ▼                              │
                          │   PlaceResolver (from @genealogy/geo,     │
                          │   no-op in Step One)                      │
                          └────────────┼─────────────────────────────┘
                                       │ depends on
                                       ▼
        ┌──────────────────────────────────────────────────────────┐
        │   @genealogy/core   (pure TS — no DOM, no network)          │
        │                                                            │
        │   gedcom/   parseGedcom(): GenealogyModel                   │
        │             (adapter over read-gedcom; date + place parse)  │
        │   graph/    buildGraph(); traversal; generations;           │
        │             enumeratePaths; detectPedigreeCollapse;         │
        │             findCommonAncestors; getEgoNetwork              │
        │   relationship/  describeRelationship()                     │
        │   geo/      PlaceResolver interface + types ONLY            │
        │   types/    Person, Family, Event, Place, Graph, GraphView  │
        └──────────────────────────────────────────────────────────┘
                                       ▲
                                       │ implements geo interface
        ┌──────────────────────────────────────────────────────────┐
        │   @genealogy/geo   (network-touching; minimal in Step One)  │
        │   - StaticTableResolver (JSON lookup, keyed on raw place)   │
        │   - NominatimResolver (optional)                            │
        │   - CachingResolver (chains + writes back)                  │
        │   - FamilySearchPlacesResolver  (documented stub, Step Two) │
        └──────────────────────────────────────────────────────────┘
```

### 4.2 Data flow (Step One)

1. User picks a `.ged` file. The web app reads it as text (in-browser `FileReader`).
2. `core.parseGedcom(text)` returns a `GenealogyModel` (people, families, events, places, warnings).
3. `core.buildGraph(model)` derives the typed person-to-person relationship graph.
4. The app picks a focal person (heuristic or user choice), calls `core.computeGenerations` and `core.getEgoNetwork`, and renders the bounded subgraph.
5. User interactions (expand, select, find paths, run collapse report) call core functions and update the rendered view. Nothing leaves the browser.

### 4.3 The two seams that preserve optionality

- **Core ↔ renderer.** The renderer consumes plain data structures (`GraphView`, `Person`, `Path`) from core and adapts them to React Flow. If the rendering library changes, or a server-side renderer is added later, core is untouched.
- **Core ↔ network (place resolution).** Core defines `PlaceResolver` as an interface and never calls it itself during Step One graph work. The web app injects an implementation. Locally that implementation is a static table plus optional Nominatim; in a hypothetical hosted future it would be a FamilySearch-backed resolver with an org key — same interface, swapped implementation. This is the one place network access differs between "local tool" and "product," and it is isolated to a single injected object.

Do not add further abstraction layers, plugin systems, or generalized renderer interfaces. Two seams, named above, are the whole discipline.

---

## 5. Data model (the normalized intermediate representation)

All types live in `@genealogy/core` under `src/types/`. These are the canonical shapes the entire system depends on; the GEDCOM parser's own output is adapted into these and never leaks past the adapter.

### 5.1 Identifiers

Within a single GEDCOM file, the xref pointer (e.g. `@I123@`) is unique and stable, so it is used directly as the canonical id, with the `@` delimiters stripped (`"I123"`). No separate id generation is needed. (If multi-file merging were ever introduced — it is explicitly out of scope — ids would need namespacing; that is a deliberately deferred concern.)

### 5.2 Core entity types

```typescript
// ---- Dates -------------------------------------------------------------
// GEDCOM dates are messy: ABT/BEF/AFT/EST/CAL qualifiers, ranges
// (BET x AND y), double-dated years (1745/46), partial dates, and
// non-Gregorian calendars. The raw string is ALWAYS preserved.

export type DateQualifier =
  | 'exact'
  | 'about'        // ABT
  | 'before'       // BEF
  | 'after'        // AFT
  | 'estimated'    // EST
  | 'calculated'   // CAL
  | 'range'        // BET ... AND ...
  | 'unknown';

export interface GenealogicalDate {
  raw: string;                 // verbatim from the file, e.g. "ABT 1798"
  qualifier: DateQualifier;
  year?: number;
  month?: number;              // 1–12
  day?: number;                // 1–31
  iso?: string;                // YYYY-MM-DD when fully and confidently known
  rangeEnd?: {                 // populated only when qualifier === 'range'
    year?: number;
    month?: number;
    day?: number;
  };
  calendar?: string;           // e.g. "julian" when not Gregorian; default Gregorian
}

// ---- Places ------------------------------------------------------------
// GEDCOM PLAC is a free-text, comma-delimited hierarchy, e.g.
// "Floyd, Kentucky, United States". Resolution to coordinates is OPTIONAL
// and, in Step One, not performed during graph work.

export type PlaceResolutionSource = 'manual' | 'familysearch' | 'nominatim';

export interface ResolvedPlace {
  lat: number;
  lon: number;
  source: PlaceResolutionSource;
  confidence: number;          // 0–1; a Nominatim guess on a historical
                               // jurisdiction is worth less than a verified
                               // or FamilySearch-standardized hit
  resolvedName?: string;       // the canonical name the resolver matched
}

export interface Place {
  raw: string;                 // verbatim PLAC string (the cache key)
  normalized: string;          // trimmed/case-folded form used for lookup
  parts?: string[];            // split hierarchy, most-specific first
  resolved?: ResolvedPlace;    // present only once a resolver has run
}

// ---- Names -------------------------------------------------------------
export interface PersonName {
  raw: string;                 // verbatim NAME value, e.g. "John /Whitaker/"
  given?: string;
  surname?: string;
  full: string;                // display form
  isPrimary: boolean;          // the first NAME is primary; others are variants
}

// ---- Source citations (provenance, kept raw) ---------------------------
export interface SourceCitation {
  raw: string;                 // verbatim citation text/pointer as found
  sourceId?: string;           // xref to a SOUR record when present
  page?: string;
}

// ---- Events (first-class, NOT edges on people) -------------------------
export type EventType =
  | 'birth' | 'death' | 'marriage' | 'burial' | 'baptism'
  | 'census' | 'residence' | 'immigration' | 'emigration'
  | 'military' | 'occupation' | 'other';

export interface Event {
  id: string;
  type: EventType;
  rawTag: string;              // original GEDCOM tag (BIRT, MARR, RESI, ...)
  date?: GenealogicalDate;
  place?: Place;
  participants: string[];      // person ids; 1 for births/deaths,
                               // 2 for marriages, etc.
  description?: string;
  sources: SourceCitation[];
}

// ---- People ------------------------------------------------------------
export type Sex = 'male' | 'female' | 'unknown';

export interface Person {
  id: string;                  // xref without @, e.g. "I123"
  externalId: string;          // full xref, e.g. "@I123@"
  names: PersonName[];         // names[0] is primary
  sex: Sex;
  eventIds: string[];          // events this person participates in
  familyIdsAsSpouse: string[]; // FAMS — families where they are a spouse/parent
  familyIdAsChild?: string;    // FAMC — the family they are a child in
  sources: SourceCitation[];
  notes?: string[];
}

// ---- Families (the GEDCOM FAM intermediary) ----------------------------
// Kept because family-level facts (marriage date/place) live here and
// because GEDCOM models parent–child relationships THROUGH families.
// The graph (Section 5.3) derives direct person-to-person edges from these.

export interface Family {
  id: string;
  externalId: string;
  spouseIds: string[];         // 0–2 (usually); parents
  childIds: string[];
  marriageEventIds: string[];
}

// ---- Top-level parsed model -------------------------------------------
export interface ParseWarning {
  severity: 'warning' | 'info';
  message: string;
  context?: string;            // e.g. the offending line or xref
}

export interface GenealogyModel {
  persons: Map<string, Person>;
  families: Map<string, Family>;
  events: Map<string, Event>;
  places: Map<string, Place>;  // keyed by Place.normalized
  warnings: ParseWarning[];
  header?: {                   // GEDCOM HEAD metadata, when present
    sourceSystem?: string;
    gedcomVersion?: string;
    rootPersonId?: string;     // if the file declares a root/home person
  };
}
```

### 5.3 Graph types

The graph is derived from `GenealogyModel`. Ancestry is a directed acyclic structure (a person points to their parents); pedigree collapse appears as reconverging paths in that DAG.

```typescript
export type EdgeType = 'parentOf' | 'spouseOf';
// childOf is the inverse of parentOf and is traversed, not stored
// separately. siblingOf is derived on demand (shared parent), not stored.

export interface GraphEdge {
  type: EdgeType;
  from: string;                // person id
  to: string;                  // person id
  // parentOf: from = parent, to = child
  // spouseOf: undirected in meaning; stored once with stable ordering
  familyId: string;            // the FAM this edge was derived from
}

export interface Graph {
  // adjacency for fast traversal in both directions
  parentsOf: Map<string, string[]>;   // child id -> parent ids
  childrenOf: Map<string, string[]>;  // parent id -> child ids
  spousesOf: Map<string, string[]>;   // person id -> spouse ids
  edges: GraphEdge[];                  // full edge list (stable order)
}

// A single relationship path between two people, as an ordered chain.
export interface PathStep {
  personId: string;
  edgeToNext?: EdgeType;       // how this person connects to the next step
}

export interface Path {
  steps: PathStep[];           // ordered; steps[0] = start, last = end
  length: number;              // number of edges (steps.length - 1)
}

// The bounded subgraph the renderer draws.
export interface GraphViewNode {
  person: Person;
  generation?: number;         // relative to focal person; focal = 0,
                               // ancestors positive, descendants negative
  isFocal: boolean;
  isPedigreeCollapsePoint: boolean;
  hasUnexpandedNeighbors: boolean; // drives the expand affordance
}

export interface GraphView {
  nodes: GraphViewNode[];
  edges: GraphEdge[];          // edges among the included nodes only
  focalPersonId: string;
}
```

---

## 6. Core library — public API

Everything in this section is exported from `@genealogy/core`'s `index.ts`. All functions are synchronous and pure unless noted. Place resolution is the only asynchronous, side-effecting concern and is handled separately (Section 8).

```typescript
// ---- Parsing -----------------------------------------------------------
// Adapter over the third-party GEDCOM parser. Produces the normalized
// model. Never throws on malformed input; collects warnings instead.
export function parseGedcom(input: string): GenealogyModel;

// ---- Graph construction -----------------------------------------------
export function buildGraph(model: GenealogyModel): Graph;

// ---- Traversal ---------------------------------------------------------
// generations: optional cap on how many generations to walk.
export function getAncestors(
  graph: Graph, personId: string, generations?: number
): string[];

export function getDescendants(
  graph: Graph, personId: string, generations?: number
): string[];

// BFS upward from the focal person; returns id -> generation number
// (parent = 1, grandparent = 2, ...). A person reachable at multiple
// depths (pedigree collapse) is recorded at their MINIMUM depth here;
// full multiplicity is exposed by enumeratePaths / detectPedigreeCollapse.
export function computeGenerations(
  graph: Graph, focalPersonId: string
): Map<string, number>;

// ---- Paths & relationships (the centerpiece logic) --------------------
// Every distinct simple path from `fromId` to `toId` following the graph.
// Guarded against blow-up (Section 7.3).
export function enumeratePaths(
  graph: Graph,
  fromId: string,
  toId: string,
  options?: { maxPaths?: number; maxDepth?: number }
): Path[];

// Ancestors of `focalPersonId` reachable by 2+ distinct paths.
// This is pedigree collapse.
export interface CollapsePoint {
  ancestorId: string;
  paths: Path[];               // the distinct paths from focal to ancestor
  pathCount: number;
}
export function detectPedigreeCollapse(
  graph: Graph,
  focalPersonId: string,
  options?: { maxPathsPerAncestor?: number; maxDepth?: number }
): CollapsePoint[];

// Nearest common ancestors of two people, with the paths from each.
export interface CommonAncestor {
  ancestorId: string;
  pathsFromA: Path[];
  pathsFromB: Path[];
  generationsFromA: number;    // shortest distance A -> ancestor
  generationsFromB: number;    // shortest distance B -> ancestor
}
export function findCommonAncestors(
  graph: Graph, personIdA: string, personIdB: string
): CommonAncestor[];

// Human-readable relationship of `toId` relative to `fromId`
// (e.g. "3rd great-grandfather", "first cousin twice removed",
// "sister"). Uses sex where known. See Section 9 for the algorithm.
export function describeRelationship(
  graph: Graph,
  model: GenealogyModel,
  fromId: string,
  toId: string
): string;

// ---- View construction -------------------------------------------------
export interface EgoNetworkOptions {
  ancestorGenerations?: number;   // default 4
  descendantGenerations?: number; // default 0
  includeSpouses?: boolean;       // default true
  nodeBudget?: number;            // default 300; see Section 10.4
}
export function getEgoNetwork(
  graph: Graph,
  model: GenealogyModel,
  focalPersonId: string,
  options?: EgoNetworkOptions
): GraphView;

// Expand one person's neighbors into an existing view (returns the
// nodes/edges to ADD; the renderer merges). `direction` lets the UI
// expand only parents, only children, or all.
export function expandPerson(
  graph: Graph,
  model: GenealogyModel,
  currentView: GraphView,
  personId: string,
  direction: 'ancestors' | 'descendants' | 'all'
): { addedNodes: GraphViewNode[]; addedEdges: GraphEdge[] };

// ---- Focal person heuristic -------------------------------------------
// Picks a default focal person: declared root if the HEAD has one;
// else the most plausible "youngest leaf" (a person with no children and
// the latest birth/known date); else the most-connected individual.
export function pickDefaultFocalPerson(
  graph: Graph, model: GenealogyModel
): string;

// ---- Step Two seam (defined now, consumed later) ----------------------
// Ordered located events for a person, for the future migration map.
export interface LocatedEvent {
  event: Event;
  place: Place;                // only events that HAVE a place
  sortKey: number;             // derived from date for chronological order
}
export function extractEventSequence(
  model: GenealogyModel, personId: string
): LocatedEvent[];
```

---

## 7. GEDCOM parsing

### 7.1 Library choice and the adapter rule

Use a maintained TypeScript-native GEDCOM parser — the recommended default is **`read-gedcom`**, which produces a queryable structured tree over the GEDCOM 5.5.1 grammar. (Verify it is current and maintained at implementation time; `parse-gedcom` is an acceptable lower-level fallback. The choice is intentionally low-stakes because of the next sentence.)

**The parser is wrapped behind our own adapter.** `parseGedcom()` is the only place in the codebase that imports the third-party library. It walks the library's output and constructs our `GenealogyModel`. Nothing else in core or the app ever sees the library's types. This means swapping parsers later touches exactly one file.

### 7.2 Mapping rules

- `INDI` → `Person`. The first `NAME` is primary (`isPrimary: true`); additional `NAME`s become variants. `SEX` → `sex`. `FAMS` pointers → `familyIdsAsSpouse`; `FAMC` → `familyIdAsChild`.
- `FAM` → `Family`. `HUSB`/`WIFE` → `spouseIds`; `CHIL` → `childIds`; `MARR` → a marriage `Event` whose `participants` are the two spouses.
- Individual event tags (`BIRT`, `DEAT`, `BURI`, `BAPM`, `CENS`, `RESI`, `IMMI`, `EMIG`, `OCCU`, military, etc.) → `Event` with the originating person in `participants`. Unknown event-like tags map to `type: 'other'` with `rawTag` preserved.
- `DATE` → `GenealogicalDate`. Parse qualifiers (`ABT`/`BEF`/`AFT`/`EST`/`CAL`), ranges (`BET … AND …` → `qualifier: 'range'` + `rangeEnd`), partial dates (year-only, year+month), and double-dated years (`1745/46` → record both the raw string and the resolved year per convention). Non-Gregorian calendar escapes set `calendar`. **Always keep `raw`.** When confidence is low or the date is unparseable, set `qualifier: 'unknown'` and leave structured fields empty — but never drop `raw`.
- `PLAC` → `Place`. Store `raw`, compute `normalized` (trim + collapse whitespace + case-fold) and `parts` (split on commas, most-specific first). Deduplicate places into `model.places` keyed by `normalized`; events reference the shared `Place`. No coordinate resolution at parse time.
- `SOUR` citations on any record → `SourceCitation[]` with `raw` preserved. This is the provenance trail; never normalize it away.

### 7.3 Robustness and the path-enumeration guard

- **Never hard-fail.** Unrecognized tags, out-of-spec structures, encoding quirks, and dangling pointers (an xref that references a missing record) become `ParseWarning`s. A dangling parent pointer simply yields no edge. The user gets a usable graph plus a warnings list.
- **Encoding.** Handle UTF-8 and the legacy ANSEL encoding GEDCOM files sometimes use; fall back gracefully and warn if encoding is ambiguous.
- **Path-enumeration blow-up.** In a deep, densely intermarried tree the number of distinct ancestor paths can grow combinatorially. `enumeratePaths` and `detectPedigreeCollapse` must enforce `maxDepth` (default e.g. 25 generations) and `maxPaths`/`maxPathsPerAncestor` (default e.g. 200) caps, and when a cap is hit, return what was found plus a flag/warning that results were truncated. Use simple-path semantics (no revisiting a person within a single path) to prevent cycles from runaway recursion. This guard is mandatory, not optional.

---

## 8. Place resolution (interface now, implementation mostly Step Two)

Place resolution is defined now so Step Two attaches cleanly, but in Step One the app injects a no-op resolver and the graph view does not depend on coordinates.

### 8.1 The interface (in `@genealogy/core`, types only)

```typescript
export interface PlaceResolver {
  resolve(place: Place): Promise<ResolvedPlace | null>;
}
```

Core defines the interface and never calls it during graph work. The app owns when (if ever, in Step One) resolution runs.

### 8.2 Implementations (in `@genealogy/geo`)

- **`StaticTableResolver`** — looks up `place.normalized` in a bundled/editable JSON table of hand-verified coordinates (`source: 'manual'`, high confidence). This is the primary source and the thing the cache grows into.
- **`NominatimResolver`** (optional) — queries OpenStreetMap Nominatim for places not in the table (`source: 'nominatim'`, lower confidence; note that it resolves historical jurisdictions to modern centroids). Must respect Nominatim usage policy (rate limit, user-agent).
- **`CachingResolver`** — wraps an ordered chain (static table → FamilySearch → Nominatim), returns the first hit, and **writes successful resolutions back into the static table** so each unique place is resolved at most once, ever. Each cache entry stores `source` and `confidence` so low-confidence guesses can be re-resolved later.
- **`FamilySearchPlacesResolver`** — documented stub only in this build. Future implementation calls the FamilySearch Places API (free, genealogy-aware, ~6M standardized historical locations) using an injected app key. Same interface; this is the "hosted/commercial" swap point.

### 8.3 Step One wiring

The web app instantiates a no-op resolver (returns `null`) — or, if trivially cheap, a `StaticTableResolver` over an empty/seed table — and the graph view ignores resolution entirely. Coordinates only matter for Step Two's map. The point of building the interface now is that Step Two adds a renderer and a resolver implementation without touching anything built in Step One.

---

## 9. Relationship description algorithm

`describeRelationship(graph, model, fromId, toId)` returns a phrase describing `toId` relative to `fromId`.

1. **Direct ancestor** — if `toId` is in `getAncestors(fromId)`, the phrase is determined by the shortest generational distance `g`: `g=1` → parent, `g=2` → grandparent, `g=3` → great-grandparent, `g≥4` → "(g−2)-great-grandparent" rendered with an ordinal ("3rd great-grandfather"). Resolve father/mother, grandfather/grandmother, etc. from `sex` when known; otherwise use the neutral term ("parent", "grandparent").
2. **Direct descendant** — symmetric, using child/grandchild/great-grandchild.
3. **Collateral** — otherwise, find nearest common ancestor(s) via `findCommonAncestors`. Let `a` = generations from `fromId` to the common ancestor and `b` = generations from `toId` to it.
   - `a == 1 && b == 1` → sibling (brother/sister/sibling by sex).
   - `min(a,b) == 1 && max(a,b) > 1` → aunt/uncle or niece/nephew (and great-/grand- prefixes as `max` grows).
   - `min(a,b) ≥ 2` → cousins: degree = `min(a,b) − 1` ("first", "second", …), removal = `|a − b|` ("once removed", "twice removed", …).
4. **No common ancestor in the file** → return "no traceable relationship within this tree."

Render ordinals and prefixes as a small helper. Full cross-cultural kinship nomenclature is out of scope; this covers the standard English genealogical terms and is structured so additional cases can be added.

---

## 10. The interactive view (web app)

### 10.1 Stack

- **React 18 + Vite + TypeScript**, strict mode.
- **`@xyflow/react` (React Flow)** for the node-link graph, chosen because ancestry is a DAG and React Flow renders rich custom nodes (person cards) with first-class pan/zoom/minimap and a clean interaction model. Pedigree collapse — reconverging edges into a shared ancestor node — displays clearly in a ranked layout, which is exactly the centerpiece. (Alternative considered: `react-force-graph`. Rejected as the primary because organic force layout trades away the generational legibility that matters most here; it remains a reasonable choice if a "whole-network" exploratory mode is ever wanted.)
- **`@dagrejs/dagre`** for layout: assign dagre rank = generation number so ancestors stack into clean generational tiers. (Upgrade path: `elkjs` if layouts get cramped or orthogonal edge routing is wanted. Start with dagre; it is the canonical React Flow layout and the path of least resistance.)
- **Zustand** for app state (focal person, expansion set, selection, path-highlight state). Lightweight and sufficient; no heavier state library.
- **Tailwind CSS** for styling (optional but fast). Keep node components legible and uncluttered.
- **Vitest** for tests across all packages.

### 10.2 The renderer adapter

A thin adapter maps `GraphView` (from core) → React Flow `nodes`/`edges`. Custom node components render a person card (primary name, birth–death years, primary place) and expose: a focal indicator, a pedigree-collapse marker, and an expand affordance when `hasUnexpandedNeighbors`. The adapter is the only code that knows about React Flow's shapes; core data structures stay library-agnostic.

### 10.3 Interaction model (these are the chosen defaults — see Section 13)

- **Load:** file picker → parse → pick default focal person → render ego network (focal + 4 ancestor generations, spouses included, descendants off).
- **Single-click a node:** select it; open the detail panel; highlight its immediate edges.
- **Expand (double-click or an explicit "+" on the node):** call `expandPerson` and merge the returned nodes/edges, re-running layout. If an expansion would push the visible node count past the budget, warn first.
- **Set as focal:** an action in the detail panel; recomputes generations and re-centers the ego network on that person.
- **Search:** name search (substring, case-insensitive, across all `names`); selecting a result can set focal or just pan-to/select.
- **Find paths between two people:** select two people → "show relationship" → call `enumeratePaths`, highlight every path (distinct colors or sequential emphasis), dim everything else, and list each path in a side panel with `describeRelationship` for each.
- **Pan/zoom/minimap:** from React Flow.

### 10.4 Node budget and the hairball problem

The default ego network is bounded (`nodeBudget`, default 300). The whole-tree view is never the default. Expansion is incremental and budget-checked. This is the concrete mitigation for the unreadable-hairball failure mode and is a requirement, not a preference.

### 10.5 Pedigree-collapse feature (the centerpiece)

This is the reason the tool exists and should be treated as a first-class feature, not an afterthought.

- **Detection:** run `detectPedigreeCollapse(focal)`; every returned `CollapsePoint.ancestorId` is marked in the graph (a ring/badge/distinct color on the node).
- **Collapse report:** a panel listing each collapse point — the ancestor's name, the number of distinct paths, and a one-line description of each relationship the paths imply (using `describeRelationship`), e.g. "John Whitaker — reached 2 ways: your 6th great-grandfather via your father's line, and your 7th great-grandfather via your mother's line."
- **Path highlighting:** selecting a collapse point (or any two people) highlights all distinct paths between focal and that ancestor, dims the rest, and shows the chains in the side panel. This directly delivers the original motivating request: seeing the different paths by which one person is related to you in different ways.

### 10.6 Warnings surface

Parse warnings (`model.warnings`) and any truncation flags from path enumeration are shown in an unobtrusive but discoverable place (e.g. a dismissible banner or a "data notes" panel), so the user knows when the file was partially read or when collapse/path results were capped.

---

## 11. Repository structure and tooling

```
genealogy-graph/
├── package.json                 # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json           # strict; shared compiler options
├── .eslintrc.cjs                # ESLint
├── .prettierrc
├── README.md                    # setup + run instructions
├── TRD.md                       # this document
├── packages/
│   ├── core/                    # @genealogy/core — pure TS, no DOM/network
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── types/           # all types from Section 5
│   │   │   ├── gedcom/          # parseGedcom adapter; date + place parsing
│   │   │   ├── graph/           # buildGraph, traversal, paths, collapse,
│   │   │   │                    #   generations, ego network, expand
│   │   │   ├── relationship/    # describeRelationship + ordinal helpers
│   │   │   ├── geo/             # PlaceResolver interface + geo types ONLY
│   │   │   └── index.ts         # public exports (Section 6)
│   │   └── tests/
│   │       ├── fixtures/        # hand-authored .ged files (Section 12)
│   │       └── *.test.ts
│   └── geo/                     # @genealogy/geo — resolver implementations
│       ├── package.json
│       └── src/
│           ├── static-table.ts
│           ├── nominatim.ts
│           ├── caching.ts
│           ├── familysearch.ts  # documented stub (Step Two)
│           └── index.ts
└── apps/
    └── web/                     # @genealogy/web — React + Vite app
        ├── package.json
        ├── index.html
        ├── vite.config.ts
        └── src/
            ├── upload/          # in-browser GEDCOM file load
            ├── graph/           # React Flow adapter, dagre layout, nodes
            ├── panels/          # detail panel, collapse report, paths,
            │                    #   search, data-notes/warnings
            ├── state/           # Zustand stores
            └── App.tsx
```

**Tooling rules**

- **pnpm workspaces** for the monorepo. `@genealogy/web` depends on `@genealogy/core` and `@genealogy/geo`; `@genealogy/geo` depends on `@genealogy/core` (for the interface/types). `@genealogy/core` depends on nothing but the GEDCOM parser (and possibly a tiny date helper).
- **Strict TypeScript** everywhere; no implicit `any`.
- **ESLint + Prettier**; a lint rule or CI check should forbid DOM/`fetch`/Node imports inside `@genealogy/core` to enforce the portability constraint.
- **`pnpm dev`** runs the Vite app. The whole tool runs locally in the browser with no server. **`pnpm test`** runs Vitest across packages; the core suite must also pass in a Node environment (proving portability).

---

## 12. Testing strategy

The core library is the asset and is almost entirely pure functions, which makes it cheap and high-value to test thoroughly. Web tests are lighter for Step One.

### 12.1 Fixtures (hand-authored `.ged` files in `packages/core/tests/fixtures/`)

Author small, readable GEDCOM files that each isolate a concern:

- `minimal.ged` — a few individuals and one family; the happy path.
- `pedigree-collapse.ged` — a cousin marriage producing a known ancestor reachable by exactly two distinct paths, with the expected path count documented in the test. This fixture validates the centerpiece.
- `multiple-marriages.ged` — a person with two spouses and children in each family.
- `messy-dates.ged` — every date qualifier (`ABT`, `BEF`, `AFT`, `BET…AND`, `EST`, `CAL`), partial dates, a double-dated year.
- `messy-places.ged` — duplicate place strings that differ only in spacing/case; a deep hierarchy; a place with a historical jurisdiction.
- `unicode-names.ged` — non-ASCII names.
- `broken.ged` — dangling pointers, an unknown tag, a structurally odd record; must parse to a usable model plus warnings, never throw.
- Optionally `large-synthetic.ged` — a generated deep tree for performance and path-cap behavior.

### 12.2 What to test

- **Parser adapter:** GEDCOM → `GenealogyModel` correctness (people, families, events, places, name/sex mapping, source citations preserved, raw strings retained). Warnings emitted (not thrown) for `broken.ged`.
- **Date parsing:** every qualifier and partial/range/double-dated case maps correctly and always retains `raw`.
- **Place parsing/dedup:** `normalized` keying collapses spacing/case duplicates into one shared `Place`.
- **Graph construction:** parent/child/spouse adjacency is correct and deterministic for the fixtures.
- **Traversal & generations:** ancestor/descendant sets and generation numbers match expected values.
- **Path enumeration:** on `pedigree-collapse.ged`, the exact set/count of distinct paths matches the documented expectation; caps truncate and flag correctly on `large-synthetic.ged`.
- **Collapse detection:** identifies the known collapse ancestor and no false positives on `minimal.ged`.
- **Relationship description:** spot-check direct-ancestor, sibling, aunt/uncle, and cousin-with-removal cases against hand-computed answers.
- **Web (lighter):** unit-test the `GraphView` → React Flow adapter (correct node/edge counts and flags); a smoke test that loading a fixture renders an ego network; basic interaction tests for expand and path-highlight if practical. No heavy end-to-end suite in Step One.

### 12.3 Workflow

Follow a plan → write tests → build → test → refactor cadence per unit, consistent with the owner's established practice. Core functions get tests written against their documented behavior before or alongside implementation, because their purity makes test-first cheap and the correctness of the path/collapse logic is the whole point of the project.

---

## 13. Decisions made on your behalf (review before build)

You asked me to make technical calls myself and to flag functionality/UX choices. I baked in defaults rather than blocking, but these five are the consequential UX decisions — each is easy to change and changing any of them does not disturb the architecture. Override any before Claude Code starts.

1. **Default focal person.** Heuristic: declared root in the GEDCOM header if present; otherwise the most plausible "youngest leaf" (no children, latest known date); otherwise the most-connected individual. Always user-overridable via search + "set as focal." *Alternative:* always prompt the user to pick on load instead of guessing.
2. **Default view is ancestors-only, 4 generations, spouses shown, descendants off.** Chosen because ancestry is the core genealogy use case and keeps the first render legible. *Alternative:* a different default depth, or descendants on by default.
3. **Expand-in-place as the primary navigation** (click to reveal a person's neighbors), with "set as focal" as a secondary recenter action. *Alternative:* make recentering the primary gesture and expansion secondary.
4. **Layout engine: dagre (hierarchical/ranked).** Chosen for generational legibility and clean display of reconverging collapse paths. *Alternative:* `react-force-graph` for an organic whole-web feel (at the cost of tidy generations), or `elkjs` for richer routing.
5. **Pedigree collapse surfaced three ways** — node markers, a collapse report panel, and path highlighting on selection. This is the centerpiece, so it gets prominent treatment by default. *Alternative:* a subset of these if you want a quieter first version.

Two smaller defaults worth noting: name search is a simple case-insensitive substring match across all name variants (fuzzy matching is deferred), and parse warnings are shown in a dismissible "data notes" surface rather than interrupting the load.

---

## 14. Trade-offs and what to revisit as it grows

Per the design framework, the explicit trade-offs and the things to reconsider later:

- **Monorepo with a separate `geo` package** adds a little upfront structure versus a single app. The payoff is the enforced no-network boundary in core and the clean Step-Two/commercial seam. Worth it; this is the structure that prevents a future rewrite.
- **React Flow + dagre** optimizes for ancestry legibility and the collapse centerpiece. If you later want true whole-network exploration (descendants, collateral webs, the full graph at once), revisit force-directed or WebGL rendering (`sigma.js`) for that mode specifically — as an additional renderer over the same core data, not a replacement.
- **xref-as-id, single file** is correct precisely because multi-source identity resolution is out of scope. The moment book-mining or multi-file merging re-enters scope (it is currently cut), ids need namespacing and a same-as identity layer must be added — that is a significant addition, deliberately deferred.
- **In-browser, in-memory model** keeps the tool dependency-free and private. If trees ever exceed comfortable in-memory size, or you want persistence/sharing, revisit a storage layer — but the core runs unchanged server-side when that day comes, which is the whole reason for the portability constraint.
- **Path-enumeration caps** trade exhaustive completeness for tractability on pathological trees. Defaults are generous; expose them as options so a power user can push them when they know a query is bounded.

The north star for every later decision: keep the valuable, hard-won logic (parsing, the normalized model, the graph and collapse algorithms) in the UI-agnostic, network-agnostic core. Renderers, resolvers, and storage are swappable layers around it. Whichever way the project grows — a richer local tool, the Step-Two map, or a hosted product — that core does not get rewritten.
