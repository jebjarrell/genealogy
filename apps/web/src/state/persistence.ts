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
export type FolderStatus = 'none' | 'connected' | 'needs-permission' | 'error';

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
      // starting a second, overlapping run - but wait for that run (plus its
      // catch-up pass) to actually finish before resolving.
      this.dirty = true;
      return this.runPromise;
    }
    this.runPromise = this.runLoop();
    try {
      await this.runPromise;
    } finally {
      this.runPromise = null;
    }
  }

  private async runLoop(): Promise<void> {
    await this.run();
    while (this.dirty) {
      this.dirty = false;
      await this.run();
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
}

export class SaveScheduler {
  private readonly sessionSave: Debounced;
  private readonly folderSave: Debounced;
  /** Hashes already written this session, so a large GEDCOM is stored once. */
  private readonly storedSources = new Set<string>();

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
    if (!snap || !session) return;

    this.opts.onSaveState('saving', null);
    try {
      if (snap.sourceBytes && !this.storedSources.has(snap.record.sourceHash)) {
        if (!(await session.hasSource(snap.record.sourceHash))) {
          await session.putSource(snap.record.sourceHash, snap.sourceBytes);
        }
        this.storedSources.add(snap.record.sourceHash);
      }
      const ok = await session.putProject({
        ...snap.record,
        updatedAt: new Date().toISOString(),
      });
      if (ok) {
        // Only point "last project" at a record that is actually there - a
        // failed write must not leave a dangling pointer that a later reload
        // would try (and fail) to restore.
        await session.setLastProject(snap.record.name);
        this.opts.onSaveState('saved', new Date().toISOString());
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
    if (!snap || !workspace) return;

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
