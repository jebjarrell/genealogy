import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseGedcom } from '@genealogy/core';
import { useStore } from './store.js';
import { MemSessionStore } from '../fs/memSessionStore.js';

// A focal person with one parent already in the tree.
const GED = `0 HEAD
0 @I1@ INDI
1 NAME Me /Doe/
1 SEX M
1 FAMC @F1@
0 @I2@ INDI
1 NAME Pa /Doe/
1 SEX M
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I2@
1 CHIL @I1@
0 TRLR
`;

const bytes = (s: string) => new TextEncoder().encode(s);

const load = (name = 'edit.ged') =>
  useStore.getState().loadModel(parseGedcom(GED), name);

describe('app store — manual editing through the op-log', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    load();
    useStore.getState().setFocal('I1');
  });

  // Flush before reset, not after: an armed autosave debounce must run against
  // the state that armed it, or snapshotOf sees a reset store and no-ops,
  // leaking a pending write into whichever test runs next. See restore.test.ts.
  afterEach(async () => {
    await useStore.getState().flushSaves();
    useStore.setState(useStore.getInitialState(), true);
  });

  it('adds a user-supplied person and attaches them as a grandparent', () => {
    const id = useStore.getState().addPerson({
      nameRaws: ['Grandpa /Doe/'],
      sex: 'male',
    })!;
    expect(id).toBe('U1');
    const person = useStore.getState().model!.persons.get(id)!;
    expect(person.userSupplied).toBe(true);
    expect(person.names[0]!.full).toBe('Grandpa Doe');

    // Link the new person as a parent of the existing father (I2).
    useStore
      .getState()
      .linkRelationship('parent-child', { parentId: id, childId: 'I2' });
    const graph = useStore.getState().graph!;
    expect(graph.parentsOf.get('I2')).toContain(id);
  });

  it('adds an event with an ABT date and a place that round-trips', () => {
    const id = useStore
      .getState()
      .addPerson({ nameRaws: ['Gran /Doe/'], sex: 'female' })!;
    useStore.getState().addEvent({
      eventType: 'birth',
      participantIds: [id],
      dateRaw: 'ABT 1700',
      placeRaw: 'Floyd, Kentucky, United States',
    });
    const model = useStore.getState().model!;
    const person = model.persons.get(id)!;
    const ev = model.events.get(person.eventIds[0]!)!;
    expect(ev.date!.qualifier).toBe('about');
    expect(ev.place!.parts).toEqual(['Floyd', 'Kentucky', 'United States']);
    expect(ev.userSupplied).toBe(true);
  });

  // localStorage's per-file `genealogy:ops:` key is gone (Task 10). The
  // beforeEach above loads through loadModel, which is in-memory only and
  // never reaches a SessionStore, so it cannot prove a reload survives one.
  // This rewrite switches to importGedcom + a MemSessionStore (the pattern
  // restore.test.ts already uses) and forces a genuine cold start - a fresh
  // AppState via getInitialState(), not just re-reading the live store's own
  // fields - so the assertions can only pass if the op-log actually round-
  // tripped through the session store and was replayed over the base model.
  it('survives a reload by replaying the op-log from base', async () => {
    const session = new MemSessionStore();
    useStore.getState().setSessionStore(session);
    await useStore.getState().importGedcom(bytes(GED), 'edit.ged');
    useStore.getState().setFocal('I1');

    useStore.getState().addPerson({ nameRaws: ['Ghost /Doe/'], sex: 'male' });
    expect(useStore.getState().ops).toHaveLength(1);
    await useStore.getState().flushSaves();

    // Cold start: a fresh store, not just re-reading fields off the live one.
    useStore.setState(useStore.getInitialState(), true);
    useStore.getState().setSessionStore(session);
    await useStore.getState().restoreSession();

    const s = useStore.getState();
    expect(s.ops).toHaveLength(1);
    const model = s.model!;
    expect(
      [...model.persons.values()].some((p) => p.names[0]!.full === 'Ghost Doe'),
    ).toBe(true);
  });

  it('undo fully reverts an addition and redo returns it', () => {
    const id = useStore
      .getState()
      .addPerson({ nameRaws: ['Temp /Doe/'], sex: 'male' })!;
    expect(useStore.getState().model!.persons.has(id)).toBe(true);

    useStore.getState().undoOp(useStore.getState().ops.length - 1);
    expect(useStore.getState().model!.persons.has(id)).toBe(false);

    useStore.getState().redo();
    expect(useStore.getState().model!.persons.has(id)).toBe(true);
  });

  // Same rewrite rationale as above: reload through a real SessionStore round
  // trip, since loadModel/load() never persists checklist state anywhere.
  it('persists checklist state and reconstructs it on reload', async () => {
    const session = new MemSessionStore();
    useStore.getState().setSessionStore(session);
    await useStore.getState().importGedcom(bytes(GED), 'edit.ged');
    useStore.getState().setFocal('I1');

    const id = useStore.getState().createChecklist('I2');
    expect(useStore.getState().checklists).toHaveLength(1);
    useStore.getState().addChecklistProof(id, {
      kind: 'record-copy',
      coveredKeys: ['I1->I2'],
      society: 'SAR',
      nationalNumber: '12345',
      patriotName: 'Pa Doe',
      approvedYear: 1990,
    });
    await useStore.getState().flushSaves();

    const record = await session.getProject('edit');
    expect(record!.checklists).toHaveLength(1);
    expect(record!.checklists[0]!.proofs).toHaveLength(1);

    // Cold start: a fresh store, not just re-reading fields off the live one.
    useStore.setState(useStore.getInitialState(), true);
    useStore.getState().setSessionStore(session);
    await useStore.getState().restoreSession();

    const s = useStore.getState();
    expect(s.checklists).toHaveLength(1);
    expect(s.checklists[0]!.proofs).toHaveLength(1);
  });
});
