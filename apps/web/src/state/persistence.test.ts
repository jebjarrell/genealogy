import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Debounced, SaveScheduler, type SaveSnapshot } from './persistence.js';
import { MemSessionStore } from '../fs/memSessionStore.js';
import { makeRecord } from '../fs/sessionStore.contract.js';
import { Workspace } from '../fs/workspace.js';
import { MemDir } from '../fs/memfs.js';

const GED = new TextEncoder().encode('0 HEAD\n0 @I1@ INDI\n0 TRLR\n');

describe('Debounced', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces repeated schedules into a single run', async () => {
    const run = vi.fn(async () => {});
    const d = new Debounced(300, run);
    d.schedule();
    d.schedule();
    d.schedule();
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('fire() runs immediately and cancels the pending timer', async () => {
    const run = vi.fn(async () => {});
    const d = new Debounced(300, run);
    d.schedule();
    expect(d.pending).toBe(true);
    await d.fire();
    expect(run).toHaveBeenCalledTimes(1);
    expect(d.pending).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1); // the timer did not also fire
  });

  it('serializes overlapping runs and re-runs once for work queued mid-flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = vi.fn(async () => {
      if (run.mock.calls.length === 1) await gate;
    });
    const d = new Debounced(300, run);

    const first = d.fire();
    const second = d.fire(); // arrives while the first is still running
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(run).toHaveBeenCalledTimes(2); // exactly one catch-up run, not two
  });

  // Regression test for a race in the brief's original sample: a fire() call
  // that arrives while a run is already in flight set the dirty flag and
  // returned right away, without waiting for the catch-up run it had just
  // queued. That breaks the exact guarantee this class exists for -- callers
  // like SaveScheduler.flush() need "the write has happened" by the time the
  // returned promise resolves, not just "the write has been queued." This
  // test pins the caller's promise to the completion of the run it triggers.
  it('fire() called while running does not resolve until the run it queued finishes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = vi.fn(async () => {
      if (run.mock.calls.length === 1) await gate;
    });
    const d = new Debounced(300, run);

    const first = d.fire();
    const second = d.fire();
    let secondResolved = false;
    void second.then(() => {
      secondResolved = true;
    });

    // Let any already-settled microtasks drain; the gate is still closed.
    await Promise.resolve();
    await Promise.resolve();
    expect(secondResolved).toBe(false);

    release();
    await second;
    expect(secondResolved).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    await first;
  });
});

describe('SaveScheduler', () => {
  let session: MemSessionStore;
  let workspace: Workspace;
  let snapshot: SaveSnapshot;

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    session = new MemSessionStore();
    workspace = new Workspace(new MemDir());
    snapshot = {
      record: makeRecord({ name: 'tree', sourceHash: 'h1' }),
      sourceBytes: GED,
    };
  });

  const make = (over: Partial<ConstructorParameters<typeof SaveScheduler>[0]> = {}) => {
    const states: string[] = [];
    const folders: string[] = [];
    const scheduler = new SaveScheduler({
      snapshot: () => snapshot,
      session: () => session,
      workspace: () => workspace,
      onSaveState: (status) => states.push(status),
      onFolderState: (status) => folders.push(status),
      ...over,
    });
    return { scheduler, states, folders };
  };

  it('writes the project record and source to the session store', async () => {
    const { scheduler, states } = make();
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(300);

    expect((await session.getProject('tree'))!.sourceHash).toBe('h1');
    expect(await session.hasSource('h1')).toBe(true);
    expect(await session.getLastProject()).toBe('tree');
    expect(states).toContain('saving');
    expect(states).toContain('saved');
  });

  it('writes the source bytes only once across repeated saves', async () => {
    const { scheduler } = make();
    const spy = vi.spyOn(session, 'putSource');
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(300);
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('mirrors to the workspace folder on the slower interval', async () => {
    const { scheduler, folders } = make();
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(await workspace.listProjects()).toEqual([]); // folder write not due yet
    await vi.advanceTimersByTimeAsync(700);
    expect(await workspace.listProjects()).toEqual(['tree']);
    expect(folders).toContain('connected');
  });

  it('flush() writes both targets immediately', async () => {
    const { scheduler } = make();
    scheduler.schedule();
    await scheduler.flush();
    expect(await session.getProject('tree')).not.toBeNull();
    expect(await workspace.listProjects()).toEqual(['tree']);
  });

  it('reports a folder failure but still saves to the session store', async () => {
    const { scheduler, states, folders } = make();
    vi.spyOn(workspace, 'saveProject').mockRejectedValue(new Error('drive gone'));
    scheduler.schedule();
    await scheduler.flush();

    expect(await session.getProject('tree')).not.toBeNull(); // browser copy is safe
    expect(folders).toContain('error');
    expect(states).not.toContain('error'); // the authoritative write succeeded
  });

  it('reports an error when the session write fails', async () => {
    session.failWrites = true;
    const { scheduler, states } = make();
    scheduler.schedule();
    await scheduler.flush();
    expect(states).toContain('error');
  });

  // Regression test for a second defect in the brief's sample: it called
  // session.setLastProject() unconditionally, even when putProject had just
  // returned false. That leaves a dangling "last project" pointer at a record
  // that was never actually written, so restoring on next load would look for
  // a project that isn't there.
  it('does not update the last-project pointer when the session write fails', async () => {
    session.failWrites = true;
    const { scheduler } = make();
    scheduler.schedule();
    await scheduler.flush();
    expect(await session.getLastProject()).toBeNull();
  });

  it('does nothing when there is no snapshot to save', async () => {
    const { scheduler, states } = make({ snapshot: () => null });
    scheduler.schedule();
    await scheduler.flush();
    expect(await session.listProjects()).toEqual([]);
    expect(states).not.toContain('saved');
  });

  it('skips the folder write when no workspace is connected', async () => {
    const { scheduler, folders } = make({ workspace: () => null });
    scheduler.schedule();
    await scheduler.flush();
    expect(await session.getProject('tree')).not.toBeNull();
    expect(folders).not.toContain('error');
  });
});
