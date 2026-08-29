# HANDOFF — Project persistence & session continuity

**Date:** 2026-07-27
**Branch:** `feat/project-persistence` (33 commits, not merged)
**Status:** Code complete and reviewed. **Blocked on one manual browser gate — see "What I need from you".**

## What it does

Opening the app now restores your most recent GEDCOM project automatically — no
re-upload, no dialog, no permission prompt — and every edit autosaves without you
pressing anything.

- Every GEDCOM import auto-creates a named project. The old unnamed "quick mode"
  that could not survive a reload is gone.
- IndexedDB is the authoritative store: GEDCOM bytes content-addressed by hash in
  their own object store, project records keyed by name, plus a `lastProject` pointer.
- The workspace folder (`F:\genealogy\Workspace`) is a best-effort mirror, written
  on a 1 s debounce, and still human-readable in Explorer.
- Re-importing identical bytes reopens the existing project with edits intact.
  Different bytes under the same filename create `name (2)` rather than merging.
- Saves flush on tab close. Folder failures raise a banner instead of failing silently.
- Two tabs on one project no longer clobber each other.

## Verification state

- 456 tests pass (core 230, geo 40, web 186). `pnpm typecheck` and `pnpm lint` clean.
- 11 implementation tasks, each with an independent review; then a whole-branch review.
- **20 defects originated in the plan's own sample code**, including four that caused
  silent data loss or on-disk corruption. All were caught by review, not by tests.

## What I need from you — the manual gate (plan Task 12)

None of this is reachable from the test environment: jsdom has no IndexedDB and no
File System Access API. Several of the branch's worst bugs were found by reading code
precisely because tests cannot see these paths.

```
pnpm dev
```

**1. Cold-start continuity (the headline promise)**
   - Load a real GEDCOM. Header should show a project name and `Saved just now`.
   - Set a focal person, edit someone, merge two people.
   - **Close the tab entirely.** Reopen.
   - Expect: tree renders immediately, no upload prompt, no dialog. Focal person,
     the edit, and the merge all present. Review tab lists both edits.

**2. The one I most expect to fail — flush on close**
   - Make an edit, then **close the tab within one second**.
   - Reopen and check the edit survived.
   - The final reviewer believes this does not work: every IndexedDB helper re-opens
     the database, so one save is 3-4 full open/close round trips, and the conflict
     check added a full record read at the head of that path. `pagehide` may not
     survive it. If the edit is gone, that is the finding — tell me and I will fix it.

**3. Folder mirroring and recovery**
   - Connect `F:\genealogy\Workspace`. Confirm `projects\<name>\` fills with
     `source.ged` and `project.json`, and that `project.json` holds your op-log.
   - Edit again; `project.json` should update within about a second.
   - Rename the workspace folder in Explorer to simulate a lost drive. Edit.
   - Expect: amber banner appears, header still reports the browser save succeeding.
   - Rename it back, click Reconnect, confirm writes resume.

**4. Import matching**
   - Import the same GEDCOM again — expect "Reopened", edits intact, no duplicate.
   - Import a *different* GEDCOM saved under the same filename — expect `name (2)`,
     original untouched.

**5. Storage inspection** (DevTools -> Application)
   - IndexedDB `genealogy-graph` at version 2 with `handles`, `sources`, `projects`, `meta`.
   - `sources` holds one entry per distinct GEDCOM, not one per save.
   - Local Storage has no `genealogy:focal:*` / `genealogy:ops:*` / `genealogy:aux:*`,
     and **still has** `genealogy:placeCache` and `ui:*`.

## Known and deliberately shipped

- The `'unknown'` folder refusal shows "A different family tree is already stored as X",
  which is wrong wording for a *damaged* project of your own. Refusal is correct; copy isn't.
- Rename is refused entirely while the workspace folder is unreadable.
- Case-only renames (`Smith Tree` -> `smith tree`) are refused: on Windows the target
  directory *is* the source, so the rename would delete the project.
- Orphaned source blobs are not garbage-collected when a project is deleted.
- The rename collision guard lives in the store action, not in the backend primitives.

## Notes

- `F:\genealogy\Workspace\` is untracked and contains your real vault documents.
  Consider gitignoring it — it is user data sitting in the repo root.
- Full execution ledger, per-task reports, and every review are under
  `.superpowers\sdd\2026-07-27-project-persistence\` (gitignored). Keep until the
  manual gate passes; the ledger records why each deferred finding was deferred.
- Design: `docs\superpowers\specs\2026-07-27-project-persistence-design.md`
- Plan: `docs\superpowers\plans\2026-07-27-project-persistence.md`

## Next

Manual gate above -> then merge `feat/project-persistence` into `main`.
Do not merge before item 2 is checked.
