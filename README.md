# Genealogy Knowledge Graph Viewer

A local, in-browser tool that loads a **GEDCOM** family-tree file, parses it into a
normalized in-memory model, and renders an interactive, ego-centric knowledge graph
you can explore. Its defining capability is showing **multiple distinct relationship
paths between the same two people** — _pedigree collapse_: the different ways a single
ancestor is related to you.

Everything runs client-side. The file never leaves your machine. Beyond viewing, it now
also supports **non-destructive manual editing**, **folder-backed projects + a document
vault** (File System Access API), a **locality research report**, an **SAR proof
checklist with evidence linking**, and a **rotatable pedigree** — all preserving the
original parsed data (every edit is an op replayed over the pristine model and is
reversible).

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

## Editing, projects, vault, SAR & locality

These build on the seams above without crossing them — all data logic lives in pure core;
File System Access lives only in the UI (`apps/web/src/fs`).

- **Manual editing (op-log).** Add/edit people, events, and parent/child/spouse links, and
  merge duplicates. Every change is an `EditOp` appended to one op-log and **replayed over
  the pristine parsed model** (`applyOps`) — originals are never mutated, manual entries are
  flagged `userSupplied`, and the Review tab gives **undo/redo**. Replaying the op-log from
  the base model always reproduces the exact current state (an asserted test).
- **Persistent projects (File System Access API).** Bind a real workspace folder; each
  project is a folder holding its GEDCOM source, op-log, SAR checklists, focal choice, and
  settings. Create / open / rename / delete; autosave is crash-safe (temp-then-promote).
- **Global document vault.** Add PDF/JPG/PNG; documents are **content-hash deduplicated**
  and shared across projects, so one certificate can back checklist items in many projects.
- **Locality research report.** For a traced line (focal → chosen ancestor) it consumes the
  **enumerated ancestral paths** (so pedigree collapse is never double-counted) and pivots
  every fact **place → year → person** with a `sourced`/`unsourced`/`none` citation status.
  The gaps are the research to-do list. Exportable as Markdown.
- **SAR proof checklist.** Pick a patriot ancestor; the child→parent links (from an
  enumerated path) plus the patriot's service item are tracked with three-state proof. A
  record copy (prior SAR/DAR application) can span multiple generations and must be
  **approved on/after 1 Jan 1985** to count; the tie-in stored is the **national number +
  patriot name**. Unproven links hand off to the locality report. SAR date/place formatting
  (`04 Jul 1776`, `City/County/ST`) is applied in context. Lineage stops at the patriot.
- **Pedigree rotation.** Toggle portrait↔landscape (dagre `TB`↔`LR`); the choice is saved in
  project settings and all interactions/highlighting hold in both.

### On-disk layout of a workspace

```
<workspace root>/
  projects/
    <project-name>/
      source.ged       # the GEDCOM source (self-contained project)
      project.json     # focal choice, op-log, SAR checklists, settings
  vault/
    documents/         # the actual PDF/JPG/PNG files, named <sha256>.<ext>
    vault-index.json   # manifest: docId → {filename, hash, mimetype, citationLinks[]}
```

> Folder-backed projects need a Chromium-based browser (File System Access API). Without it,
> the app still works and persists per-file to `localStorage`.

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
  **Spouses**, **Siblings**, **Descendants**, and **Marriage links** back on.
- **Click** a person to open the detail panel. It leads with a **bio sketch** (birth, death,
  spouse(s), # children, military service + war era), with the full events, relationships,
  and source citations kept below — each with its raw source string. Click again to deselect.
- **Double-click** a person (or the **+** on a card) to **extend the pedigree** one more
  generation back — parents only, so the graph stays to direct ancestors. (Use the detail
  panel's **+ Descendants** / the **Siblings** toggle to bring in collaterals.)
- **Search on Ancestry, FamilySearch, and DAR**: the detail panel builds pre-filled search
  links for the selected person (no account or API needed — they open in a new tab).
- **Search** by name and **set a new focal person**.
- **Select two people** → see every distinct relationship path between them, each
  described in relationship terms. **Reset view** / **Clear paths** from the toolbar.
- **Pedigree collapse** is surfaced three ways: node markers, a collapse report panel, and
  path highlighting on selection.
- **Map** (the migration view): switch to **Map** to see **all your ancestors' migration**
  over time by default, or **focus a single line** (focal → a chosen ancestor); scrub the
  year slider to animate it. Geocoding tries OpenStreetMap Nominatim first, then falls back
  to **Photon** (komoot) when Nominatim is rate-limited or blocked in the browser — **place
  names** (not your file) are sent to the geocoder and cached locally; messy strings (e.g.
  `Fleming Co., KY, Kentucky, USA`) are cleaned and coarsened so historical places resolve.
- **Family** (the analytics view): switch to **Family** for statistics across your direct
  ancestors — count & generation depth, longevity, most common birthplaces, average family
  size, and military service by war. Computed entirely from your file; no LLM.
- **Military service** detail: a person's military events are standardized into branch / unit /
  rank / war / dates in the detail panel (raw text preserved beneath).
- **Merge duplicates** (non-destructive): select **two** people, click **Merge 2**, pick which
  record survives, and confirm from the before→after preview. Links move over and duplicates
  are removed. Your original file is never modified — merges are an op-log replayed on top.
- **Review** (the edit view): switch to **Review** to see every merge, **undo** any of them, and
  **export** the current (merged) data as GEDCOM (derived) or JSON (lossless). Merges persist
  per file across reloads.
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
