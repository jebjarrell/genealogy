import type { SessionProjectRecord, SessionStore } from '../fs/sessionStore.js';
import type { Workspace } from '../fs/workspace.js';
import type { ProjectFile } from '../fs/project.js';

// Autosave orchestration, kept out of store.ts so the store stays about state
// and this stays about durability.
//
// Two targets with different costs and different guarantees:
//   session store (IndexedDB) - authoritative, fast, debounced 300ms
//   workspace folder          - best-effort mirror, slower, debounced 1s
// A failure of the first is reported as a save error; a failure of the second
// only marks the folder unavailable, because the user's work is still safe.

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type FolderStatus =
  | 'none'
  | 'connected'
  | 'needs-permission'
  | 'error'
  | 'name-conflict';

export const SESSION_DEBOUNCE_MS = 300;
export const FOLDER_DEBOUNCE_MS = 1000;

/**
 * A trailing-edge debounce whose runs never overlap. Work requested while a run
 * is in flight sets a dirty flag and triggers exactly one catch-up run, so a
 * burst of edits can never interleave two writes to the same record.
 *
 * fire() always resolves only once the run it triggered (or joined) has
 * actually finished - including any catch-up pass. A caller that reaches
 * fire() while another run is already in progress does not get an early
 * "queued" resolution; it shares the promise for the run that will cover its
 * request. This matters because flush() is built on fire(): the app calls
 * flush() when the tab is closing, and needs "the write has happened" by the
 * time the returned promise settles, not just "the write has been queued."
 */
export class Debounced {
  private timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Non-null exactly while a run (including any catch-up pass) is in flight.
   * Doubles as the reentrancy guard and the promise joiners await - both
   * assigned synchronously, before run() is ever invoked, and cleared
   * synchronously, before that assignment's promise is allowed to settle.
   * See fire() for why both edges have to be atomic with no gap.
   */
  private runPromise: Promise<void> | null = null;
  private dirty = false;

  constructor(
    private readonly delayMs: number,
    private readonly run: () => Promise<void>,
  ) {}

  get pending(): boolean {
    return this.timer !== null;
  }

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.fire(), this.delayMs);
  }

  /** Run now, cancelling any pending timer. */
  async fire(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.runPromise) {
      // A run is already in flight. Fold this request into it rather than
      // starting a second, overlapping run - and wait for that run (plus its
      // catch-up pass) to actually finish before resolving, not just for the
      // request to be queued.
      this.dirty = true;
      return this.runPromise;
    }

    // Claimed synchronously, before run() is invoked, so a reentrant fire()
    // call arriving from inside run() itself (e.g. a host callback invoked
    // synchronously that calls flush()) sees a run already in flight instead
    // of racing to start a second one.
    let settle!: () => void;
    this.runPromise = new Promise<void>((resolve) => {
      settle = resolve;
    });
    try {
      await this.run();
      while (this.dirty) {
        this.dirty = false;
        await this.run();
      }
    } finally {
      // Cleared here - synchronously, in the same turn that resolves the
      // promise - not in a later continuation of this method. If it were
      // cleared after an `await this.runPromise` one level up instead, there
      // would be a one-microtask window where runPromise is still non-null
      // but already resolved: a fire() landing in that window would "join" a
      // promise that will never run again, silently dropping its request
      // (the dirty flag it sets would be stranded, since the while loop that
      // checks it has already exited). Clearing before settle() closes that
      // window: any fire() that observes runPromise has not yet had its
      // settlement effects run, so it either truly joins an active run or
      // correctly sees none and starts a fresh one.
      this.runPromise = null;
      settle();
    }
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export interface SaveSnapshot {
  record: SessionProjectRecord;
  /** Null when the source is already known to be stored. */
  sourceBytes: Uint8Array | null;
}

export interface SaveSchedulerOptions {
  /** Current state to persist; null when there is nothing open. */
  snapshot: () => SaveSnapshot | null;
  session: () => SessionStore | null;
  workspace: () => Workspace | null;
  onSaveState: (status: SaveStatus, at: string | null) => void;
  onFolderState: (status: FolderStatus) => void;
  /** Called when another tab has written this project since our last save. */
  onConflict?: (name: string) => void;
}

export class SaveScheduler {
  private readonly sessionSave: Debounced;
  private readonly folderSave: Debounced;
  /** Hashes already confirmed written this session, so a large GEDCOM is stored once. */
  private readonly storedSources = new Set<string>();
  /** The session store the cache above was built against; see runSession(). */
  private lastSession: SessionStore | null = null;
  /**
   * This tab's claim on the record it last wrote: the project name and the
   * updatedAt we wrote for it. The scheduler only ever writes one project -
   * the currently open one - so a single claim (not one per name) is enough,
   * and it self-invalidates on rename or project switch: the next run's
   * snapshot carries a different `record.name`, the claim's name no longer
   * matches, and the check below is skipped rather than compared against
   * unrelated data. That matters because `renameProject` is the only other
   * writer of a project record: it moves the record to a new key while
   * preserving `updatedAt`, so a claim keyed by the *old* name would compare
   * cleanly-renamed data against a claim that was never updated for it - a
   * false conflict on a single healthy tab (fix round 1, finding 1). Null
   * means no claim at all: first save this session, or the session store
   * instance changed since (see runSession()). Either way there is nothing
   * to compare against, so a healthy single-tab session is never blocked
   * spuriously.
   */
  private claim: { name: string; updatedAt: string } | null = null;
  /**
   * Once true, stays true for the lifetime of this scheduler: a losing tab
   * must stop saving permanently, not just for one debounce cycle, or it
   * would silently resume clobbering the winning tab's work.
   */
  private conflicted = false;

  constructor(private readonly opts: SaveSchedulerOptions) {
    this.sessionSave = new Debounced(SESSION_DEBOUNCE_MS, () => this.runSession());
    this.folderSave = new Debounced(FOLDER_DEBOUNCE_MS, () => this.runFolder());
  }

  schedule(): void {
    this.sessionSave.schedule();
    this.folderSave.schedule();
  }

  /** Write both targets now. Called on page hide and before switching projects. */
  async flush(): Promise<void> {
    await this.sessionSave.fire();
    await this.folderSave.fire();
  }

  dispose(): void {
    this.sessionSave.cancel();
    this.folderSave.cancel();
  }

  private async runSession(): Promise<void> {
    const snap = this.opts.snapshot();
    const session = this.opts.session();
    // Once conflicted, stay stopped - see the `conflicted` field comment.
    if (!snap || !session || this.conflicted) return;

    // `session` is a getter, not a fixed reference - the host can hand back a
    // different SessionStore instance (e.g. after a storage reconnect). The
    // stored-sources cache is only valid against the store it was built
    // against, so drop it when the instance changes rather than trusting
    // hashes that may only exist in a store we are no longer writing to.
    // The same applies to our conflict-detection claim below: it was staked
    // against the old instance, so treat it as unknown against the new one
    // rather than risk comparing it to unrelated data and firing a spurious
    // conflict against a perfectly healthy single tab.
    if (session !== this.lastSession) {
      this.storedSources.clear();
      this.claim = null;
      this.lastSession = session;
    }

    this.opts.onSaveState('saving', null);
    try {
      // If the stored record has moved on from what we last wrote, another
      // tab has written it since - stop rather than overwrite work we cannot
      // see. A claim under a different name means this run is a rename or a
      // project switch, not the project we staked the claim on - skip the
      // check rather than compare it to unrelated data (see the `claim`
      // field comment). No claim at all means nothing to compare against
      // either way. Both cases leave a healthy single-tab session unblocked.
      if (this.claim && this.claim.name === snap.record.name) {
        const current = await session.getProject(snap.record.name);
        if (current && current.updatedAt !== this.claim.updatedAt) {
          this.conflicted = true;
          this.opts.onSaveState('error', null);
          this.opts.onConflict?.(snap.record.name);
          return;
        }
      }

      if (snap.sourceBytes && !this.storedSources.has(snap.record.sourceHash)) {
        if (!(await session.hasSource(snap.record.sourceHash))) {
          await session.putSource(snap.record.sourceHash, snap.sourceBytes);
          // putSource() returns void and both implementations swallow a
          // failed write rather than surfacing it: MemSessionStore no-ops
          // under failWrites, and IdbSessionStore awaits idbPut() but
          // discards the boolean it resolves to (idbPut itself swallows
          // onerror/onabort and resolves false). Without this check, a
          // quota-exceeded source write would still get cached as "stored",
          // and a later putProject() could succeed and report "saved" for a
          // record whose sourceHash points at a blob that was never written
          // - unopenable on reload. Verify the write actually landed before
          // trusting the cache.
          if (!(await session.hasSource(snap.record.sourceHash))) {
            this.opts.onSaveState('error', null);
            return;
          }
        }
        this.storedSources.add(snap.record.sourceHash);
      }
      const updatedAt = new Date().toISOString();
      const ok = await session.putProject({ ...snap.record, updatedAt });
      if (ok) {
        // Only point "last project" at a record that is actually there - a
        // failed write must not leave a dangling pointer that a later reload
        // would try (and fail) to restore.
        await session.setLastProject(snap.record.name);
        // This is now our claim on the record: the next run compares the
        // stored updatedAt against this value to notice if another tab wrote
        // over it in between.
        this.claim = { name: snap.record.name, updatedAt };
        this.opts.onSaveState('saved', updatedAt);
      } else {
        this.opts.onSaveState('error', null);
      }
    } catch {
      this.opts.onSaveState('error', null);
    }
  }

  private async runFolder(): Promise<void> {
    const snap = this.opts.snapshot();
    const workspace = this.opts.workspace();
    // Once a session-store conflict has latched, the folder mirror must stop
    // too - it is the same project, so it would otherwise keep overwriting
    // the winning tab's project.json with this tab's stale state even though
    // the session-store write already refused (fix round 1, finding 2). The
    // `name-conflict` hash guard below does not catch this: same project,
    // same sourceHash, so it never triggers.
    if (!snap || !workspace || this.conflicted) return;

    try {
      const existing = await workspace.listProjects();
      if (!existing.includes(snap.record.name)) {
        if (!snap.sourceBytes) return; // cannot create the folder without a source
        await workspace.createProject(
          snap.record.name,
          snap.sourceBytes,
          snap.record.sourceFileName,
          snap.record.sourceHash,
        );
      } else {
        // A folder project that shares our name is not necessarily OUR project.
        // saveProject rewrites project.json and never touches source.ged, so
        // writing over a different tree leaves that tree's GEDCOM sitting
        // beside our op-log and our hash: a project that replays foreign ops
        // (applyOps is total - it skips what it cannot match, in silence) and
        // mis-identifies itself the next time an import matches by content.
        // Only a matching hash - or an unknown one ('', written before the
        // field existed) - is safe to write over.
        const onDisk = await workspace.projectSummary(snap.record.name);
        if (
          onDisk &&
          onDisk.sourceHash &&
          onDisk.sourceHash !== snap.record.sourceHash
        ) {
          // Stop the mirror rather than corrupt it, and never in silence. This
          // is a refusal, not a failure - the folder is fine and reconnecting
          // would change nothing, so it gets its own status distinct from
          // 'error' (drive unplugged / permission revoked / folder deleted).
          // The session copy still holds the user's work either way.
          this.opts.onFolderState('name-conflict');
          return;
        }
      }
      await workspace.saveProject(toProjectFile(snap.record));
      this.opts.onFolderState('connected');
    } catch {
      // Drive unplugged, permission revoked, folder deleted. The session store
      // still has the work, so this is a status change, not a save failure.
      this.opts.onFolderState('error');
    }
  }
}

/** Project record (browser shape) -> project.json (disk shape). */
export function toProjectFile(record: SessionProjectRecord): ProjectFile {
  return {
    format: 'genealogy-graph/project',
    version: 1,
    name: record.name,
    sourceFile: 'source.ged',
    sourceFileName: record.sourceFileName,
    sourceHash: record.sourceHash,
    focalPersonId: record.focalPersonId,
    ops: record.ops,
    checklists: record.checklists,
    settings: record.settings,
    updatedAt: record.updatedAt,
  };
}
