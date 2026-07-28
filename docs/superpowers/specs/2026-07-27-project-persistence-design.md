# Project Persistence & Session Continuity — Design

**Date:** 2026-07-27
**Status:** Approved, pending implementation plan

## Problem

Opening the app requires re-uploading the GEDCOM, and edits only survive a reload
under a narrow set of conditions the user is unlikely to have met. Concretely:

1. **The GEDCOM bytes are never stored outside a named project.** In the default
   "quick mode" (no workspace folder bound) `sourceBytes` is memory-only. The
   op-log *is* written to `localStorage`, but on reload there is no base model to
   replay it onto, so the saved ops are unreachable and the user must re-upload.
2. **Nothing remembers the last-opened project.** `restoreWorkspace()`
   (`App.tsx:97`) rebinds the folder handle and lists projects, then stops. The
   user lands on an empty app and must open a project by hand.
3. **The folder rebind fails silently on cold start.** `restoreWorkspace` calls
   `ensurePermission`, which calls `requestPermission()` outside a user gesture.
   Chrome requires transient user activation for that call, so it cannot succeed
   on page load; the function returns false and `restoreWorkspace` bails with no
   message.
4. **Saving a project is a manual, named step.** `saveAsProject` requires opening
   the workspace modal, typing a name, and clicking Save. Work done before that
   step is not folder-backed.
5. **Autosave has a durability hole.** `persist()` debounces 400 ms with no flush
   on page hide, so closing the tab shortly after an edit drops it.
6. **Folder write failures are swallowed.** `persist()` ends in `.catch(() => {})`,
   so a disconnected drive or revoked permission produces no signal at all.

Evidence of the impact: the workspace at `F:\genealogy\Workspace` contains a
`vault/` but no `projects/` directory. The user has connected a workspace and
added vault documents but has never saved a project — all work to date has been
in the mode that cannot survive a reload.

## Goals

- Reopening the app restores the most recent project automatically, with no
  upload, no dialog, and no permission prompt.
- Every edit persists without the user thinking about saving.
- Work remains visible and portable on disk when a workspace folder is available.
- Failures to write to disk are surfaced, not swallowed.

## Non-goals

- Rebasing an existing op-log onto a re-exported GEDCOM source (see Decision 3).
- Cross-device or cloud sync.
- Multi-tab conflict *resolution*. Multi-tab *detection* is in scope.
- Recovering the orphaned `localStorage` op-logs from the current design
  (see Decision 5).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Session state lives in **both** IndexedDB and the workspace folder | IndexedDB restores instantly with no permission prompt and works in every browser; the folder stays the durable, human-inspectable, backup-able copy. |
| 2 | Every import **auto-creates a named project** | Removes the quick-mode/project-mode split, which is the root cause of the reported problem. There is one concept, and it is always persistent. |
| 3 | A re-export with **different content becomes a new project** | Ops reference GEDCOM person IDs, which a re-export can renumber. Replaying an old op-log onto a new base risks silently attaching edits to the wrong person. Identical content (hash match) reopens the existing project. |
| 4 | Save state is **visible**; folder failures raise a banner | Silent failure is the worst outcome for durability, and external-drive loss is a known recurring event in this environment. |
| 5 | Orphaned `localStorage` op-logs are **dropped** | Confirmed with the user: nothing there is worth recovering. Avoids a filename-match adoption path that would reintroduce the ID hazard from Decision 3. |

## Architecture

### Storage model

Extend the existing `genealogy-graph` IndexedDB database from v1 to v2. It
currently holds a single `handles` store (`fs/handleStore.ts`).

| Store | Key | Value | Written |
|---|---|---|---|
| `sources` | content hash (sha256 hex) | GEDCOM bytes | Once per distinct file |
| `projects` | project name | ops, checklists, settings, focalPersonId, sourceHash, sourceFileName, createdAt, updatedAt | Every edit, debounced |
| `meta` | `'lastProject'` | project name | On project open / switch |
| `handles` | `'workspace-root'` | directory handle *(existing)* | On connect |

`sources` is split from `projects` deliberately: a 20 MB GEDCOM must not be
rewritten every 400 ms alongside a one-line op. The split also gives content
dedupe for free, mirroring how the vault already content-addresses documents.

The DB-open and upgrade logic moves out of `handleStore.ts` into a shared
`fs/idb.ts`. Two modules opening the same database name at different versions
block each other, so a single owner of the version number is required.

The on-disk layout is unchanged: `projects/<name>/{source.ged, project.json}`
and `vault/{documents/, vault-index.json}`. `ProjectFile` gains one field,
`sourceHash`, so a folder project can be matched against an imported file
without re-reading and re-hashing its `source.ged`. `parseProject` already fills
missing fields defensively, so existing `project.json` files load unchanged with
`sourceHash` absent; it is recomputed and written on the next save.

### Boot sequence

`App.tsx` currently calls `restoreWorkspace()` alone. It calls `restoreSession()`
instead, which does two independent things:

**Restore the project (always, unconditionally):**

1. Read `meta.lastProject`.
2. Load that project record and its source bytes from IndexedDB.
3. `parseGedcom` → `applyOps` → render, restoring focal person, checklists, and
   settings.

No dialog, no click, no permission check. This path works in every browser and
is the mechanism that satisfies the primary requirement.

**Rebind the folder (opportunistic, non-blocking):**

1. `loadHandle()`.
2. Call **`queryPermission` only** — never `requestPermission` on boot.
3. `granted` → bind the workspace, refresh projects and vault, set
   `folderStatus: 'connected'`.
4. `prompt` or `denied` → set `folderStatus: 'needs-permission'` and surface a
   Reconnect control.

`ensurePermission` is split into `hasPermission` (query-only, safe on boot) and
`requestPermissionInteractive` (query-then-request, for use behind a click).
This is the fix for problem 3: the request moves behind the Reconnect button,
which supplies the user gesture the API requires.

The two paths are independent. A restored project renders whether or not the
folder rebinds.

### Import flow

`loadModel` is replaced by `importGedcom(bytes, fileName)`:

1. `sha256Hex(bytes)` (`fs/hash.ts`, already present).
2. Search IndexedDB projects, then folder projects if bound, for a matching
   `sourceHash`.
   - **Hit in IndexedDB** → open that project, ops intact. Notice:
     `Reopened "<name>".`
   - **Hit in the folder only** → open it from disk and cache it into IndexedDB,
     so the next cold start restores it without the folder. This is also the path
     taken by `openProjectByName` when the user switches projects.
   - **Miss** → derive a project name from the filename, sanitized and
     uniquified; create the project.
3. Write source bytes to `sources` (skipped if the hash is already present),
   write the project record, set `meta.lastProject`.
4. If a workspace is bound, mirror to the folder.

A new `fs/projectName.ts` owns name derivation, because these strings become
directory names on Windows:

- Strip the extension; strip `\ / : * ? " < > |` and control characters.
- Trim leading/trailing whitespace and trailing dots.
- Reject the reserved device names `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`,
  `LPT1`–`LPT9` (case-insensitive, with or without extension) by suffixing.
- Cap length (100 chars) to stay clear of path limits.
- Fall back to `Untitled` when nothing usable remains.
- Uniquify against existing names as `name`, `name (2)`, `name (3)`.

Without this, a file such as `M*A*S*H.ged` produces a `getDirectoryHandle` call
that throws and is swallowed by `RealDir.getDir`'s catch, silently yielding no
project.

The "Load sample" button routes through the same path, so the bundled sample
becomes a normal project and reopens by hash rather than duplicating.

### Autosave

Save orchestration moves out of `store.ts` into `state/persistence.ts`.
`store.ts` is 971 lines; this is a natural seam, and the new logic (two backends,
debounce, flush, in-flight locking, status) would otherwise roughly double the
persistence code embedded in it.

- **IndexedDB:** debounced ~300 ms. Authoritative.
- **Folder:** debounced ~1 s. Best-effort mirror.
- **Flush on `visibilitychange` (hidden) and `pagehide`.** Fixes problem 5.
  `pagehide` handlers cannot await, so the flush issues the write synchronously
  and relies on the browser to complete the in-flight IndexedDB transaction.
- **In-flight lock plus a dirty flag.** A save already in progress does not start
  a second one; it sets `dirty` and re-runs on completion. Prevents interleaved
  writes to the same record.
- **`navigator.storage.persist()`** requested once when the first project is
  created, so the browser does not evict the user's work under storage pressure.
  Guarded — a no-op where unsupported.

The `localStorage` paths (`rememberKey`, `opsKey`, `auxKey` and their helpers)
are deleted. A one-time cleanup removes any surviving `genealogy:focal:*`,
`genealogy:ops:*`, and `genealogy:aux:*` keys on first boot after the upgrade.
The UI-preference keys used by `usePersisted` (`ui:leftOpen`, `ui:rightOpen`)
stay in `localStorage` and are untouched.

### Status and failure reporting

New store slice:

```ts
saveState: { status: 'idle' | 'saving' | 'saved' | 'error'; lastSavedAt: string | null }
folderStatus: 'none' | 'connected' | 'needs-permission' | 'error'
```

The header shows `<project> · <folder chip> · Saved 2m ago`. When a folder write
fails, `folderStatus` becomes `error` and a dismissible banner appears:

> Can't write to the workspace folder. Your work is saved in this browser.
> **[Reconnect] [Dismiss]**

IndexedDB writes continue regardless. A failed IndexedDB write — the
authoritative store — sets `saveState.status: 'error'` and is reported directly,
since at that point nothing is durable.

**Backfill.** On connect or reconnect, any project present in IndexedDB but
absent from the folder is mirrored to disk. This makes a week of work done
without the external drive land correctly once the drive returns.

**Multi-tab detection.** Each tab holds a session id. Before writing, the tab
compares the record's `updatedAt` against what it last wrote; a mismatch means
another tab has written. The stale tab stops autosaving and shows "This project
is open in another tab" rather than clobbering via last-write-wins. Detection
only — no merge, no resolution.

## Testing

The codebase already commits to an interface-plus-in-memory-fake pattern for
storage (`fs/fsa.ts` defines `FsDir`; `fs/memfs.ts` implements it for jsdom
tests, exercised by `fs/workspace.test.ts`). Session storage follows it: a
`SessionStore` interface, an `IdbSessionStore`, and a `MemSessionStore` fake.
This keeps the test environment dependency-free rather than adding
`fake-indexeddb`.

Coverage:

- **sessionStore** — put/get project; source dedupe by hash; `lastProject`
  round-trip; rename migrates the record key; delete removes record and orphaned
  source.
- **projectName** — illegal characters, reserved device names, empty/whitespace
  input, length cap, uniquify sequence.
- **import** — hash hit reopens with ops intact; hash miss creates; name
  collision with differing content uniquifies; sample loads as a project.
- **restore** — boot with a `lastProject` renders the model with ops applied and
  focal restored; boot with none leaves the empty state; a `lastProject` whose
  source is missing degrades to the empty state without throwing.
- **permissions** — boot never calls `requestPermission`; Reconnect does.
- **autosave** — debounce coalesces repeated edits into one write; flush-on-hide
  writes a pending edit; concurrent saves serialize; a folder failure sets
  `folderStatus: 'error'` while the IndexedDB write still succeeds.
- **backfill** — connecting a workspace mirrors browser-only projects to disk.

## Files

**New**

- `apps/web/src/fs/idb.ts` — shared DB open/upgrade, owns the version
- `apps/web/src/fs/sessionStore.ts` — `SessionStore` interface + IDB implementation
- `apps/web/src/fs/memSessionStore.ts` — in-memory fake for tests
- `apps/web/src/fs/projectName.ts` — sanitize + uniquify
- `apps/web/src/state/persistence.ts` — debounce, flush, dual-write, status
- Tests alongside each

**Modified**

- `apps/web/src/fs/handleStore.ts` — use `idb.ts` instead of opening the DB itself
- `apps/web/src/fs/fsa.ts` — split `ensurePermission` into query-only and interactive
- `apps/web/src/fs/project.ts` — add `sourceHash` to `ProjectFile` and `parseProject`
- `apps/web/src/fs/workspace.ts` — accept `sourceHash` on create; expose project hashes for matching
- `apps/web/src/state/store.ts` — `importGedcom`, `restoreSession`, save-state slice; remove the `localStorage` ops/aux paths and the now-meaningless `saveAsProject` action. `openProjectByName` stays (project switching) and additionally caches to IndexedDB. `deleteProjectByName` clears `meta.lastProject` when it deletes the open project, so the next boot starts empty rather than pointing at a deleted record.
- `apps/web/src/App.tsx` — boot calls `restoreSession`; header save indicator; folder banner
- `apps/web/src/panels/WorkspaceModal.tsx` — remove "Save current file as a project"; add Reconnect; mark browser-only vs. mirrored projects
- `apps/web/src/upload/UploadButton.tsx` — route both buttons through `importGedcom`

## Risks

| Risk | Mitigation |
|---|---|
| IndexedDB unavailable (private mode, storage disabled) | `handleStore.ts` already guards on `typeof indexedDB`. `SessionStore` degrades to a no-op; the app works for the session and says so via `saveState`. |
| Browser eviction of IndexedDB under disk pressure | `navigator.storage.persist()` at first project creation; the folder mirror is the backstop. |
| Large GEDCOM slows boot | Source bytes are read once and parsed off the critical path; parse cost is unchanged from today's upload path. Revisit only if measured. |
| DB version bump races two open handles | Single owner in `fs/idb.ts`; `handleStore` refactored to use it in the same change. |
