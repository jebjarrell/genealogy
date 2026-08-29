import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseGedcom } from '@genealogy/core';
import { useStore } from './store.js';
import { MemSessionStore } from '../fs/memSessionStore.js';

// A child (I1) with parents I2/I3 and a duplicate of the mother (I3DUP).
const GED = `0 HEAD
0 @I1@ INDI
1 NAME Child /X/
1 FAMC @F1@
0 @I2@ INDI
1 NAME Pa /X/
1 SEX M
1 FAMS @F1@
0 @I3@ INDI
1 NAME Ma /X/
1 SEX F
1 FAMS @F1@
0 @I3DUP@ INDI
1 NAME Ma /X/
1 SEX F
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I3@
1 CHIL @I1@
0 TRLR
`;

const bytes = (s: string) => new TextEncoder().encode(s);

const load = (name = 'merge.ged') =>
  useStore.getState().loadModel(parseGedcom(GED), name);

describe('app store — merge edit layer', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  // Flush before reset, not after: an armed autosave debounce must run against
  // the state that armed it, or snapshotOf sees a reset store and no-ops,
  // leaking a pending write into whichever test runs next. See restore.test.ts.
  afterEach(async () => {
    await useStore.getState().flushSaves();
    useStore.setState(useStore.getInitialState(), true);
  });

  it('merges two records, shrinks the model, and records the op', () => {
    load();
    useStore.getState().setFocal('I1');
    useStore.getState().mergePeople('I3', 'I3DUP');
    const s = useStore.getState();
    expect(s.model!.persons.has('I3DUP')).toBe(false);
    expect(s.model!.persons.size).toBe(3);
    expect(s.ops).toHaveLength(1);
    expect(s.ops[0]!.kind).toBe('merge');
    expect(s.baseModel!.persons.has('I3DUP')).toBe(true); // pristine untouched
  });

  // localStorage's per-file `genealogy:ops:` key is gone (Task 10); op-log
  // persistence now runs through a SessionStore, which loadModel (used by
  // `load()` above) never touches - only importGedcom does. These two tests
  // switch to importGedcom + a MemSessionStore so they keep proving a real
  // round trip: the op lands in the store record, and a cold start (a fresh
  // AppState, not just re-reading in-process fields) replays it.

  it('persists the op-log and replays it on reload', async () => {
    const session = new MemSessionStore();
    useStore.getState().setSessionStore(session);
    await useStore.getState().importGedcom(bytes(GED), 'merge.ged');
    useStore.getState().setFocal('I1');
    useStore.getState().mergePeople('I3', 'I3DUP');
    await useStore.getState().flushSaves();

    const record = await session.getProject('merge');
    expect(record).not.toBeNull();
    expect(record!.ops).toHaveLength(1);
    expect(record!.ops[0]).toMatchObject({ kind: 'merge', mergeId: 'I3DUP' });

    // Cold start: a fresh store, not just re-reading fields off the live one.
    useStore.setState(useStore.getInitialState(), true);
    useStore.getState().setSessionStore(session);
    await useStore.getState().restoreSession();

    const s = useStore.getState();
    expect(s.ops).toHaveLength(1);
    expect(s.model!.persons.has('I3DUP')).toBe(false);
  });

  it('undo restores the merged-away record; redo re-applies it', async () => {
    const session = new MemSessionStore();
    useStore.getState().setSessionStore(session);
    await useStore.getState().importGedcom(bytes(GED), 'merge.ged');
    useStore.getState().setFocal('I1');
    useStore.getState().mergePeople('I3', 'I3DUP');
    useStore.getState().undoMerge(0);
    await useStore.getState().flushSaves();

    let s = useStore.getState();
    expect(s.ops).toHaveLength(0);
    expect(s.model!.persons.has('I3DUP')).toBe(true);
    expect((await session.getProject('merge'))!.ops).toEqual([]);

    useStore.getState().redo();
    await useStore.getState().flushSaves();
    s = useStore.getState();
    expect(s.ops).toHaveLength(1);
    expect(s.model!.persons.has('I3DUP')).toBe(false);
    expect((await session.getProject('merge'))!.ops).toHaveLength(1);
  });

  it('remaps the focal person when it is merged away', () => {
    load();
    useStore.getState().setFocal('I1');
    // Fold the focal (I1) into I3; the survivor is I3.
    useStore.getState().mergePeople('I3', 'I1');
    expect(useStore.getState().focalPersonId).toBe('I3');
  });
});
