import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store.js';
import { MemSessionStore } from '../fs/memSessionStore.js';
import pedigreeGed from '../../../../packages/core/tests/fixtures/pedigree-collapse.ged?raw';
import cousinsGed from '../../../../packages/core/tests/fixtures/cousins.ged?raw';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('importGedcom — auto-creates a project', () => {
  let session: MemSessionStore;

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    session = new MemSessionStore();
    useStore.getState().setSessionStore(session);
  });

  it('names the project from the filename and stores source + record', async () => {
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'jarrell-tree.ged');
    await useStore.getState().flushSaves();

    const s = useStore.getState();
    expect(s.projectName).toBe('jarrell-tree');
    expect(s.model).not.toBeNull();

    const record = await session.getProject('jarrell-tree');
    expect(record).not.toBeNull();
    expect(await session.hasSource(record!.sourceHash)).toBe(true);
    expect(await session.getLastProject()).toBe('jarrell-tree');
  });

  it('sanitizes an illegal filename into a safe project name', async () => {
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'M*A*S*H.ged');
    expect(useStore.getState().projectName).toBe('M A S H');
  });

  it('reopens the existing project when the same bytes are imported again', async () => {
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    await useStore.getState().flushSaves();
    useStore.getState().setFocal('I11');
    await useStore.getState().flushSaves();

    // Wipe the store between the two imports, keeping only the session store.
    // Without this the assertions below pass on state that merely carried over
    // in-process; the point is that the reopen genuinely reads the project
    // back out of the browser copy.
    useStore.setState(useStore.getInitialState(), true);
    useStore.getState().setSessionStore(session);

    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    await useStore.getState().flushSaves();

    const s = useStore.getState();
    expect(s.projectName).toBe('tree'); // not "tree (2)"
    expect(s.focalPersonId).toBe('I11'); // prior work intact
    expect(await session.listProjects()).toHaveLength(1);
  });

  it('creates a second project when different bytes share a filename', async () => {
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    await useStore.getState().flushSaves();
    await useStore.getState().importGedcom(bytes(cousinsGed), 'tree.ged');
    await useStore.getState().flushSaves();

    expect(useStore.getState().projectName).toBe('tree (2)');
    const names = (await session.listProjects()).map((r) => r.name).sort();
    expect(names).toEqual(['tree', 'tree (2)']);
  });

  it('names distinct projects for different bytes sharing a filename even with no flush and no backend to consult', async () => {
    // No session store and no workspace: nothing autosaves anywhere, so the
    // only thing that can prevent the second import from colliding onto the
    // first project's name is seeding `taken` with the currently-open
    // project name (get().projectName), not the (empty) session/folder
    // listings.
    useStore.getState().setSessionStore(null);
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    expect(useStore.getState().projectName).toBe('tree');

    await useStore.getState().importGedcom(bytes(cousinsGed), 'tree.ged');
    expect(useStore.getState().projectName).toBe('tree (2)');
  });

  it('autosaves an edit made after import without any explicit save', async () => {
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    useStore.getState().setFocal('I11');
    useStore.getState().editPerson('I11', { nameRaws: ['Edited /Name/'], sex: 'male' });
    await useStore.getState().flushSaves();

    const record = await session.getProject('tree');
    expect(record!.ops).toHaveLength(1);
    expect(record!.focalPersonId).toBe('I11');
  });

  it('works with no session store at all (storage disabled)', async () => {
    useStore.getState().setSessionStore(null);
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    expect(useStore.getState().model).not.toBeNull();
    expect(useStore.getState().projectName).toBe('tree');
  });
});
