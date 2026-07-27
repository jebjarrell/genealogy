import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Debounced, SaveScheduler, type SaveSnapshot } from './persistence.js';
import { MemSessionStore } from '../fs/memSessionStore.js';
import { makeRecord } from '../fs/sessionStore.contract.js';
import { Workspace } from '../fs/workspace.js';
import { MemDir } from '../fs/memfs.js';
import type { SessionProjectRecord, SessionStore } from '../fs/sessionStore.js';

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

  // Widened from the brief's original (a single reentrant fire()) per review:
  // with only one reentrant call, an implementation that queued one catch-up
  // run *per request* would also produce exactly 2 total run() calls here,
  // so that version of the test could not distinguish "one catch-up run"
  // from "one catch-up run per request." Issuing three reentrant calls before
  // release() pins the stronger guarantee: still exactly 2 runs total.
  it('serializes overlapping runs and re-runs exactly once for all work queued mid-flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = vi.fn(async () => {
      if (run.mock.calls.length === 1) await gate;
    });
    const d = new Debounced(300, run);

    const first = d.fire();
    const second = d.fire(); // three requests arrive while the first is still running
    const third = d.fire();
    const fourth = d.fire();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second, third, fourth]);
    // A "queue one catch-up per request" implementation would call run() 4
    // times here; the guarantee is exactly one catch-up covering all of them.
    expect(run).toHaveBeenCalledTimes(2);
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

  // Regression test for a narrower, one-tick version of the same bug (review
  // finding I-1), which survives even after the fix above: the first
  // implementation of the fix cleared the "run in flight" marker in fire()'s
  // own continuation, one microtask *after* the run it was tracking actually
  // settled. A fire() landing in that exact gap saw a non-null marker,
  // "joined" it, and got a promise that had already resolved without ever
  // covering the joiner's request - a silent lost write, just harder to hit.
  //
  // This test does not rely on timing luck: it chains its own probe directly
  // off the same promise the class is already internally awaiting, via
  // `run.mock.results`, so the probe is guaranteed to run in the same
  // microtask batch as - and immediately after - the class's own internal
  // continuation for that promise. That is deterministically the gap in
  // question, every run.
  it('fire() arriving in the microtask gap right after settlement still gets its own run', async () => {
    const resolvers: Array<() => void> = [];
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const d = new Debounced(300, run);

    const first = d.fire();
    expect(run).toHaveBeenCalledTimes(1);
    const p1 = run.mock.results[0]!.value as Promise<void>;

    let second: Promise<void> | undefined;
    // Registered on the exact promise the class's internal `await this.run()`
    // is already waiting on. When p1 settles, handlers run in registration
    // order: the class's own continuation first (same microtask batch), this
    // probe second - landing precisely in the settle-to-clear gap.
    const probeRan = p1.then(() => {
      second = d.fire();
    });

    resolvers[0]!();
    await probeRan;
    expect(second).toBeDefined();

    // If the joiner correctly triggered its own run (the fix), a second
    // run() call is now genuinely in flight and needs its own resolution.
    // If it instead silently adopted the already-settled promise from run #1
    // (the bug), no second call ever happens and there is nothing to do here
    // - `second` will still resolve on its own, just without covering the
    // joiner's request, which is exactly what the assertion below catches.
    if (resolvers.length > 1) resolvers[1]!();

    await second;
    await first;

    // With the bug, the joiner's dirty flag is set but nothing ever rechecks
    // it, so run() is called only once total.
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('SaveScheduler', () => {
  let session: MemSessionStore;
  let workspace: Workspace;
  let snapshot: SaveSnapshot;
  let schedulers: SaveScheduler[];

  beforeEach(() => {
    vi.useFakeTimers();
    session = new MemSessionStore();
    workspace = new Workspace(new MemDir());
    snapshot = {
      record: makeRecord({ name: 'tree', sourceHash: 'h1' }),
      sourceBytes: GED,
    };
    schedulers = [];
  });

  afterEach(() => {
    // Fixtures above are shared `let` bindings captured by the option thunks
    // passed to each SaveScheduler. A straggling debounce timer or catch-up
    // run left over from one test could still fire during a later test and
    // write into that test's fresh fixtures. Dispose every scheduler created
    // in make() so nothing outlives its test.
    for (const s of schedulers) s.dispose();
    vi.useRealTimers();
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
    schedulers.push(scheduler);
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

  // Regression test (review finding M-3): guarantee 2 - "a burst of edits
  // collapses into one write of the latest state" - was never actually
  // exercised. Every existing test calls schedule() once and never mutates
  // the snapshot before the timer fires, so a scheduler that captured the
  // snapshot at schedule() time (instead of at run time) would have passed
  // all of them too. Mutate the snapshot after schedule() and confirm the
  // value that lands is the latest one, not the one at schedule() time.
  it('captures the snapshot at run time, so a late edit before the debounce fires still lands', async () => {
    const { scheduler } = make();
    scheduler.schedule();
    snapshot = {
      ...snapshot,
      record: { ...snapshot.record, focalPersonId: 'I42' },
    };
    await vi.advanceTimersByTimeAsync(300);
    expect((await session.getProject('tree'))!.focalPersonId).toBe('I42');
  });

  // Regression test (review finding I-2): a SessionStore whose putSource()
  // silently fails to persist (both real implementations can do this -
  // MemSessionStore under failWrites, and IdbSessionStore/idbPut swallowing
  // onerror/onabort) must not be cached as "stored." If it were, a later
  // putProject() that happens to succeed (a small record can fit where a
  // large GEDCOM did not) would report "saved" for a project record whose
  // sourceHash points at a blob that was never written - unopenable on
  // reload. This store's putProject() always succeeds even though putSource()
  // never actually stores anything, isolating the case from the store-wide
  // failWrites flag used elsewhere.
  class SourceDroppingStore implements SessionStore {
    private projects = new Map<string, SessionProjectRecord>();
    private last: string | null = null;
    available(): boolean {
      return true;
    }
    async putSource(): Promise<void> {
      /* silently drops the write, like a quota-exceeded IndexedDB put */
    }
    async getSource(): Promise<Uint8Array | null> {
      return null;
    }
    async hasSource(): Promise<boolean> {
      return false; // never actually landed
    }
    async deleteSource(): Promise<void> {}
    async putProject(record: SessionProjectRecord): Promise<boolean> {
      this.projects.set(record.name, record);
      return true;
    }
    async getProject(name: string): Promise<SessionProjectRecord | null> {
      return this.projects.get(name) ?? null;
    }
    async listProjects(): Promise<SessionProjectRecord[]> {
      return [...this.projects.values()];
    }
    async deleteProject(name: string): Promise<void> {
      this.projects.delete(name);
    }
    async renameProject(): Promise<SessionProjectRecord | null> {
      return null;
    }
    async getLastProject(): Promise<string | null> {
      return this.last;
    }
    async setLastProject(name: string | null): Promise<void> {
      this.last = name;
    }
  }

  it('reports an error (and does not write the project record) when the source write silently fails to land', async () => {
    const flaky = new SourceDroppingStore();
    const states: string[] = [];
    const scheduler = new SaveScheduler({
      snapshot: () => snapshot,
      session: () => flaky,
      workspace: () => null,
      onSaveState: (status) => states.push(status),
      onFolderState: () => {},
    });
    schedulers.push(scheduler);
    scheduler.schedule();
    await scheduler.flush();

    expect(states).toContain('error');
    expect(states).not.toContain('saved');
    // Must not report the project as saved while its source never landed.
    expect(await flaky.getProject('tree')).toBeNull();
  });

  // Regression test (review finding I-2, staleness half): the stored-sources
  // cache must not outlive the store it was verified against. If the host's
  // `session()` getter starts returning a different store instance (e.g.
  // after a storage reconnect), a hash cached from the old store must not be
  // trusted for the new one.
  it('clears the stored-sources cache when the session store instance changes', async () => {
    let current: SessionStore = session;
    const scheduler = new SaveScheduler({
      snapshot: () => snapshot,
      session: () => current,
      workspace: () => workspace,
      onSaveState: () => {},
      onFolderState: () => {},
    });
    schedulers.push(scheduler);

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(await current.hasSource('h1')).toBe(true);

    const next = new MemSessionStore();
    current = next;
    const spy = vi.spyOn(next, 'putSource');
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(spy).toHaveBeenCalledTimes(1); // not skipped by a cache from the old store
  });

  // Regression test: two tabs open on the same project. Both autosave to the
  // same session-store record; without detection, last-write-wins silently
  // drops whichever tab saved second. This pins that the losing tab notices
  // the record moved out from under it and stops writing rather than
  // clobbering the other tab's work.
  it('stops saving and reports a conflict when another tab wrote the record', async () => {
    const conflicts: string[] = [];
    const { scheduler } = make({ onConflict: (name) => conflicts.push(name) });

    scheduler.schedule();
    await scheduler.flush();

    // Another tab writes the same record behind our back.
    await session.putProject({
      ...(await session.getProject('tree'))!,
      updatedAt: '2099-01-01T00:00:00.000Z',
      focalPersonId: 'OTHER-TAB',
    });

    scheduler.schedule();
    await scheduler.flush();

    expect(conflicts).toEqual(['tree']);
    // The other tab's write survived; we did not clobber it.
    expect((await session.getProject('tree'))!.focalPersonId).toBe('OTHER-TAB');
  });

  // Regression test (fix round 1, finding 3): the test above flushes twice,
  // so the conflict fires exactly once and cannot distinguish a latching
  // scheduler from one that would happily resume saving on the next cycle.
  // "Once true, stays true" is the whole contract of the `conflicted` flag -
  // a stopped tab must not silently start clobbering again. Pin it with a
  // third schedule()/flush() cycle after the conflict has already fired.
  it('keeps refusing to save on later cycles once a conflict has latched', async () => {
    const conflicts: string[] = [];
    const { scheduler } = make({ onConflict: (name) => conflicts.push(name) });

    scheduler.schedule();
    await scheduler.flush();

    await session.putProject({
      ...(await session.getProject('tree'))!,
      updatedAt: '2099-01-01T00:00:00.000Z',
      focalPersonId: 'OTHER-TAB',
    });

    scheduler.schedule();
    await scheduler.flush();
    expect(conflicts).toEqual(['tree']); // fired once

    // A later edit in this (losing) tab schedules another save. The latch
    // must still be in effect - no second onConflict call, and still no
    // write over the other tab's record.
    scheduler.schedule();
    await scheduler.flush();

    expect(conflicts).toEqual(['tree']); // still just the one call
    expect((await session.getProject('tree'))!.focalPersonId).toBe('OTHER-TAB');
  });

  // Regression test (fix round 1, finding 2): runFolder()'s guard never
  // checked the conflicted flag, so the losing tab kept mirroring its own
  // (stale) state to the workspace folder after the session-store conflict
  // latched - silently diverging project.json from the winning tab's copy,
  // while the notice claims "no longer being saved here."
  it('stops mirroring to the workspace folder once a conflict has latched', async () => {
    const { scheduler, folders } = make();

    scheduler.schedule();
    await scheduler.flush();
    expect(await workspace.listProjects()).toEqual(['tree']);

    await session.putProject({
      ...(await session.getProject('tree'))!,
      updatedAt: '2099-01-01T00:00:00.000Z',
      focalPersonId: 'OTHER-TAB',
    });

    // This save is refused by the session-store conflict check, latching
    // `conflicted`. Change the folder-visible field too, so a still-running
    // folder mirror would be caught in the act.
    snapshot = {
      ...snapshot,
      record: { ...snapshot.record, focalPersonId: 'LOSING-TAB' },
    };
    scheduler.schedule();
    await scheduler.flush();

    const folderWritesBefore = folders.filter((s) => s === 'connected').length;
    scheduler.schedule();
    await scheduler.flush();

    expect(folders.filter((s) => s === 'connected').length).toBe(folderWritesBefore);
    const onDisk = await workspace.openProject('tree');
    expect(onDisk!.project.focalPersonId).not.toBe('LOSING-TAB');
  });

  // Regression test (fix round 1, finding 1): SessionStore.renameProject()
  // moves a record to a new key while preserving its updatedAt - the only
  // writer of a project record besides the scheduler itself. A rename
  // round-trip (tree -> other -> tree) by a single, perfectly healthy tab
  // used to leave a stale claim under the original name that no longer
  // matched what the rename had just written there, latching a false
  // conflict and permanently disabling autosave for a user who never had a
  // second tab open. renameCurrentProject() always flushes immediately
  // before each rename (to settle any pending save under the old name), so
  // this reproduces without any waiting.
  it('does not fire a false conflict after a project is renamed away and back to its original name', async () => {
    const conflicts: string[] = [];
    const { scheduler } = make({ onConflict: (name) => conflicts.push(name) });

    // Save under the original name.
    scheduler.schedule();
    await scheduler.flush();
    await vi.advanceTimersByTimeAsync(1000);

    // Rename tree -> other, mirroring renameCurrentProject(): flush first,
    // then move the record.
    await scheduler.flush();
    snapshot = {
      ...snapshot,
      record: (await session.renameProject('tree', 'other'))!,
    };
    await vi.advanceTimersByTimeAsync(1000);

    // First save under the new name.
    scheduler.schedule();
    await scheduler.flush();
    await vi.advanceTimersByTimeAsync(1000);

    // Rename back to the original name.
    await scheduler.flush();
    snapshot = {
      ...snapshot,
      record: (await session.renameProject('other', 'tree'))!,
    };
    await vi.advanceTimersByTimeAsync(1000);

    // Save again under the original name - this is where a stale claim
    // keyed by name used to collide with the record the rename just wrote.
    scheduler.schedule();
    await scheduler.flush();

    expect(conflicts).toEqual([]);
    expect((await session.getProject('tree'))!.name).toBe('tree');
  });
});
