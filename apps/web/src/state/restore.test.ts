import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useStore } from './store.js';
import { MemSessionStore } from '../fs/memSessionStore.js';
import { Workspace } from '../fs/workspace.js';
import { MemDir } from '../fs/memfs.js';
import { sha256Hex } from '../fs/hash.js';
import pedigreeGed from '../../../../packages/core/tests/fixtures/pedigree-collapse.ged?raw';

const bytes = (s: string) => new TextEncoder().encode(s);

/** Import a project, then simulate a cold start with the same session store. */
async function importThenReload(session: MemSessionStore, fileName = 'tree.ged') {
  useStore.getState().setSessionStore(session);
  await useStore.getState().importGedcom(bytes(pedigreeGed), fileName);
  useStore.getState().setFocal('I11');
  useStore.getState().editPerson('I11', { nameRaws: ['Edited /Name/'], sex: 'male' });
  await useStore.getState().flushSaves();

  useStore.setState(useStore.getInitialState(), true); // fresh page load
  useStore.getState().setSessionStore(session);
  await useStore.getState().restoreSession();
}

// Every test that touches the store leaves the autosave debounce armed. Reset
// first, then flush: the flush cancels both timers, and with no project open
// the run it triggers is a no-op, so nothing leaks into the next test.
async function quiesce() {
  useStore.setState(useStore.getInitialState(), true);
  await useStore.getState().flushSaves();
}

describe('restoreSession', () => {
  let session: MemSessionStore;

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    session = new MemSessionStore();
  });

  afterEach(quiesce);

  it('reopens the last project with its model, ops, and focal person', async () => {
    await importThenReload(session);
    const s = useStore.getState();
    expect(s.projectName).toBe('tree');
    expect(s.model).not.toBeNull();
    expect(s.ops).toHaveLength(1);
    expect(s.focalPersonId).toBe('I11');
    expect(s.view).not.toBeNull();
    expect(s.focalPickerOpen).toBe(false);
  });

  it('leaves the app empty when there is no last project', async () => {
    useStore.getState().setSessionStore(session);
    await useStore.getState().restoreSession();
    expect(useStore.getState().model).toBeNull();
    expect(useStore.getState().projectName).toBeNull();
  });

  it('degrades to the empty state when the source bytes are missing', async () => {
    await importThenReload(session);
    const hash = (await session.getProject('tree'))!.sourceHash;
    await session.deleteSource(hash);

    useStore.setState(useStore.getInitialState(), true);
    useStore.getState().setSessionStore(session);
    await useStore.getState().restoreSession();

    expect(useStore.getState().model).toBeNull();
    expect(useStore.getState().notice).toContain('could not be restored');
    // The dangling pointer is cleared so the next boot starts clean.
    expect(await session.getLastProject()).toBeNull();
  });

  it('does nothing harmful with no session store', async () => {
    useStore.getState().setSessionStore(null);
    await useStore.getState().restoreSession();
    expect(useStore.getState().model).toBeNull();
  });

  it('restores with no folder bound at all', async () => {
    // The headline promise: no workspace, no permission, no gesture.
    await importThenReload(session);
    expect(useStore.getState().workspace).toBeNull();
    expect(useStore.getState().model).not.toBeNull();
  });
});

describe('backfillFolder', () => {
  let session: MemSessionStore;

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    session = new MemSessionStore();
  });

  afterEach(quiesce);

  it('mirrors browser-only projects to a newly connected folder', async () => {
    useStore.getState().setSessionStore(session);
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    await useStore.getState().flushSaves();

    const workspace = new Workspace(new MemDir());
    useStore.setState({ workspace, folderStatus: 'connected' });
    await useStore.getState().backfillFolder();

    expect(await workspace.listProjects()).toEqual(['tree']);
    const opened = await workspace.openProject('tree');
    expect(opened!.project.focalPersonId).toBe(useStore.getState().focalPersonId);
  });

  it('does not overwrite a project already present in the folder', async () => {
    const workspace = new Workspace(new MemDir());
    await workspace.createProject('tree', bytes(pedigreeGed), 'tree.ged', 'existing-hash');
    useStore.getState().setSessionStore(session);
    useStore.setState({ workspace, folderStatus: 'connected' });
    await useStore.getState().backfillFolder();

    expect((await workspace.openProject('tree'))!.project.sourceHash).toBe('existing-hash');
  });

  it('leaves a same-named folder project untouched when the browser also has one', async () => {
    // The brief's version of the test above runs against an empty session
    // store, so the "already present" guard is never actually reached. Put a
    // real browser record in the way of a real folder record of the same name.
    useStore.getState().setSessionStore(session);
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    await useStore.getState().flushSaves();

    const workspace = new Workspace(new MemDir());
    await workspace.createProject('tree', bytes('0 HEAD\n0 TRLR\n'), 'other.ged', 'existing-hash');
    useStore.setState({ workspace, folderStatus: 'connected' });
    await useStore.getState().backfillFolder();

    const opened = await workspace.openProject('tree');
    expect(opened!.project.sourceHash).toBe('existing-hash');
    expect(new TextDecoder().decode(opened!.gedcomBytes)).toBe('0 HEAD\n0 TRLR\n');
  });
});

describe('openProjectByName', () => {
  let session: MemSessionStore;

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    session = new MemSessionStore();
    useStore.getState().setSessionStore(session);
  });

  afterEach(quiesce);

  it('reopens a browser-only project with no folder bound', async () => {
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    useStore.getState().setFocal('I11');
    await useStore.getState().flushSaves();

    useStore.setState(useStore.getInitialState(), true);
    useStore.getState().setSessionStore(session);
    await useStore.getState().openProjectByName('tree');

    expect(useStore.getState().workspace).toBeNull();
    expect(useStore.getState().projectName).toBe('tree');
    expect(useStore.getState().focalPersonId).toBe('I11');
  });

  it('computes a hash for a legacy folder project so it can autosave', async () => {
    // A project.json written before sourceHash existed carries ''. snapshotOf
    // refuses to save on a falsy hash, so without computing one here the
    // project would never autosave and would report no error.
    const workspace = new Workspace(new MemDir());
    await workspace.createProject('legacy', bytes(pedigreeGed), 'legacy.ged');
    expect((await workspace.openProject('legacy'))!.project.sourceHash).toBe('');

    useStore.setState({ workspace, folderStatus: 'connected' });
    await useStore.getState().openProjectByName('legacy');

    const expected = await sha256Hex(bytes(pedigreeGed));
    expect(useStore.getState().sourceHash).toBe(expected);

    useStore.getState().editPerson('I11', { nameRaws: ['Edited /Name/'], sex: 'male' });
    await useStore.getState().flushSaves();
    expect(useStore.getState().saveState.status).toBe('saved');
    expect((await session.getProject('legacy'))!.ops).toHaveLength(1);
  });

  it('caches a folder-only project into the session store on open', async () => {
    const workspace = new Workspace(new MemDir());
    await workspace.createProject('ondisk', bytes(pedigreeGed), 'ondisk.ged', 'disk-hash');

    useStore.setState({ workspace, folderStatus: 'connected' });
    await useStore.getState().openProjectByName('ondisk');
    await useStore.getState().flushSaves();

    const record = await session.getProject('ondisk');
    expect(record).not.toBeNull();
    expect(await session.hasSource(record!.sourceHash)).toBe(true);
    // The next cold start finds it without the folder.
    expect(await session.getLastProject()).toBe('ondisk');
  });

  it('reports a failure instead of doing nothing when there is no folder copy', async () => {
    await useStore.getState().openProjectByName('missing');
    expect(useStore.getState().model).toBeNull();
    expect(useStore.getState().notice).toContain('Could not open project');
  });

  it('reports a failure when the folder has no such project', async () => {
    useStore.setState({ workspace: new Workspace(new MemDir()), folderStatus: 'connected' });
    await useStore.getState().openProjectByName('missing');
    expect(useStore.getState().notice).toContain('Could not open project');
  });
});

describe('deleteProjectByName', () => {
  let session: MemSessionStore;

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    session = new MemSessionStore();
    useStore.getState().setSessionStore(session);
  });

  afterEach(quiesce);

  it('clears the last-project pointer when the open project is deleted', async () => {
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    await useStore.getState().flushSaves();
    expect(await session.getLastProject()).toBe('tree');

    await useStore.getState().deleteProjectByName('tree');

    expect(await session.getProject('tree')).toBeNull();
    expect(await session.getLastProject()).toBeNull();
    expect(useStore.getState().projectName).toBeNull();
    expect(useStore.getState().sourceHash).toBeNull();

    // A dead project must not come back from a pending autosave.
    await useStore.getState().flushSaves();
    expect(await session.getProject('tree')).toBeNull();
  });

  it('restores nothing on the next boot after the open project is deleted', async () => {
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    await useStore.getState().flushSaves();
    await useStore.getState().deleteProjectByName('tree');

    useStore.setState(useStore.getInitialState(), true);
    useStore.getState().setSessionStore(session);
    await useStore.getState().restoreSession();

    expect(useStore.getState().model).toBeNull();
    expect(useStore.getState().projectName).toBeNull();
  });
});

describe('renameCurrentProject', () => {
  let session: MemSessionStore;

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    session = new MemSessionStore();
    useStore.getState().setSessionStore(session);
  });

  afterEach(quiesce);

  it('renames the browser record with no folder bound', async () => {
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    await useStore.getState().flushSaves();

    await useStore.getState().renameCurrentProject('family');
    await useStore.getState().flushSaves();

    expect(useStore.getState().projectName).toBe('family');
    expect(await session.getProject('tree')).toBeNull();
    expect(await session.getProject('family')).not.toBeNull();
    expect(await session.getLastProject()).toBe('family');
  });
});
