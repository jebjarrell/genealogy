import { describe, it, expect, beforeEach } from 'vitest';
import { parseGedcom } from '@genealogy/core';
import { useStore } from './store.js';

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

  it('merges two records, shrinks the model, and records the op', () => {
    load();
    useStore.getState().setFocal('I1');
    useStore.getState().mergePeople('I3', 'I3DUP');
    const s = useStore.getState();
    expect(s.model!.persons.has('I3DUP')).toBe(false);
    expect(s.model!.persons.size).toBe(3);
    expect(s.merges).toHaveLength(1);
    expect(s.baseModel!.persons.has('I3DUP')).toBe(true); // pristine untouched
  });

  it('persists merges and replays them on reload', () => {
    load();
    useStore.getState().setFocal('I1');
    useStore.getState().mergePeople('I3', 'I3DUP');
    expect(localStorage.getItem('genealogy:merges:merge.ged')).toContain('I3DUP');

    // Reload the same file: the persisted merge should replay.
    load();
    const s = useStore.getState();
    expect(s.merges).toHaveLength(1);
    expect(s.model!.persons.has('I3DUP')).toBe(false);
  });

  it('undo restores the merged-away record', () => {
    load();
    useStore.getState().setFocal('I1');
    useStore.getState().mergePeople('I3', 'I3DUP');
    useStore.getState().undoMerge(0);
    const s = useStore.getState();
    expect(s.merges).toHaveLength(0);
    expect(s.model!.persons.has('I3DUP')).toBe(true);
    expect(localStorage.getItem('genealogy:merges:merge.ged')).toBe('[]');
  });

  it('remaps the focal person when it is merged away', () => {
    load();
    useStore.getState().setFocal('I1');
    // Fold the focal (I1) into I3; the survivor is I3.
    useStore.getState().mergePeople('I3', 'I1');
    expect(useStore.getState().focalPersonId).toBe('I3');
  });
});
