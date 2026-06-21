# Genealogy Knowledge Graph Viewer

A local, in-browser tool that loads a **GEDCOM** family-tree file, parses it into a
normalized in-memory model, and renders an interactive, ego-centric knowledge graph
you can explore. Its defining capability is showing **multiple distinct relationship
paths between the same two people** — _pedigree collapse_: the different ways a single
ancestor is related to you.

Everything runs client-side. The file never leaves your machine. This is a **read-only
viewer**; it never edits or writes back to the tree.

> Build specification: [`TRD.md`](./TRD.md). The TRD is the source of truth.

---

## Architecture

A pnpm monorepo with two hard architectural boundaries (TRD §4.3):

```
packages/core   @genealogy/core   Pure TypeScript. No DOM, no network, no Node-only
                                  APIs, no rendering libraries. GEDCOM parsing, the
                                  normalized model, and all graph algorithms live here.
packages/geo    @genealogy/geo    PlaceResolver implementations (network-touching).
                                  Depends only on core's interface + types.
apps/web        @genealogy/web     React + Vite + React Flow UI. Depends on core & geo.
```

- **Core ↔ renderer seam.** The renderer consumes plain data (`GraphView`, `Person`,
  `Path`) from core and adapts them to React Flow. Core never imports a UI library.
- **Core ↔ network seam.** Core defines `PlaceResolver` as an interface and never calls
  the network. The app injects an implementation (a no-op in Step One).

The first boundary is **enforced by lint in CI**: any `fetch`, DOM global, Node built-in,
or rendering-library import inside `@genealogy/core` fails the build. The core test suite
runs under **Node**, proving the same logic is portable to a non-browser environment.

---

## Prerequisites

- **Node.js ≥ 18** (developed against Node 20/22)
- **pnpm ≥ 10** — install with `npm install -g pnpm` or `corepack enable`

## Setup

```bash
pnpm install
```

## Run the app

```bash
pnpm dev
```

Vite prints a local URL (default `http://localhost:5173`). Open it, click **Load GEDCOM**,
and pick a `.ged` file. The app parses it in-browser, picks a sensible default focal
person, and renders the ego network. Sample fixtures live in
`packages/core/tests/fixtures/` (e.g. `pedigree-collapse.ged`).

## Other commands

| Command          | What it does                                            |
| ---------------- | ------------------------------------------------------- |
| `pnpm build`     | Type-check & build every package                        |
| `pnpm test`      | Run the full Vitest suite across all packages           |
| `pnpm test:core` | Run only the `@genealogy/core` suite (Node environment) |
| `pnpm lint`      | ESLint, including the core portability firewall         |
| `pnpm typecheck` | `tsc --noEmit` across all packages                      |
| `pnpm format`    | Prettier write                                          |

---

## Using the viewer

- **Load** a `.ged` file → pick who _you_ are (the focal person) in the picker; the choice
  is remembered per file and changeable anytime from the header.
- The graph renders **direct ancestors only** by default. Use the toolbar to toggle
  **Spouses**, **Descendants**, and **Marriage links** back on.
- **Click** a person to open the detail panel (names, events, places, sources — each with
  the raw source string); click again to deselect.
- **Expand** a person to reveal their not-yet-shown neighbors, subject to a node budget.
- **Search** by name and **set a new focal person**.
- **Select two people** → see every distinct relationship path between them, each
  described in relationship terms. **Reset view** / **Clear paths** from the toolbar.
- **Pedigree collapse** is surfaced three ways: node markers, a collapse report panel, and
  path highlighting on selection.
- **Map** (the migration view): switch to **Map**, pick an ancestor, and scrub the year
  slider to watch that ancestral line migrate over time. Geocoding uses OpenStreetMap
  Nominatim — **place names** (not your file) are sent to OSM and cached locally.
- **Collapsible panels**: collapse the side panels to give the graph/map room.
- **Data notes**: parse warnings and any path-enumeration truncation are surfaced in a
  dismissible panel — a malformed file still produces a usable graph.

---

## Repository layout

```
packages/core/src/types/         Canonical data model (TRD §5)
packages/core/src/gedcom/        parseGedcom adapter; date + place + name parsing
packages/core/src/graph/         buildGraph, traversal, generations, paths, collapse,
                                 common ancestors, ego network, expand, focal heuristic
packages/core/src/relationship/  describeRelationship + ordinal helpers
packages/core/src/geo/           PlaceResolver interface + geo types ONLY
packages/core/tests/fixtures/    Hand-authored .ged files (TRD §12.1)
packages/geo/src/                StaticTable / Nominatim / Caching / FamilySearch stub
apps/web/src/                    upload, graph adapter, panels, state, App
```

See [`DEVIATIONS.md`](./DEVIATIONS.md) for the running log of assumptions, deviations,
and resolved TRD ambiguities.
