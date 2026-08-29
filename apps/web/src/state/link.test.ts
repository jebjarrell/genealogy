import { describe, it, expect, beforeEach } from 'vitest';
import { parseGedcom } from '@genealogy/core';
import { useStore } from './store.js';

//   F1: Henry (I1) + Catherine (I2) -> Mary (I4)
//   F2: Henry (I1) + Anne (I3)      -> Elizabeth (I5)
//   I6 Orphan has no family at all.
const GED = `0 HEAD
0 @I1@ INDI
1 NAME Henry /King/
1 SEX M
1 FAMS @F1@
1 FAMS @F2@
0 @I2@ INDI
1 NAME Catherine /First/
1 SEX F
1 FAMS @F1@
0 @I3@ INDI
1 NAME Anne /Second/
1 SEX F
1 FAMS @F2@
0 @I4@ INDI
1 NAME Mary /King/
1 SEX F
1 FAMC @F1@
0 @I5@ INDI
1 NAME Elizabeth /King/
1 SEX F
1 FAMC @F2@
0 @I6@ INDI
1 NAME Orphan /Nobody/
1 SEX M
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I4@
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I3@
1 CHIL @I5@
0 TRLR
`;

const link = () => useStore.getState().linkRelationship;

describe('linkRelationship — joining an existing family', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    useStore.getState().loadModel(parseGedcom(GED), 'link.ged');
    useStore.getState().setFocal('I1');
  });

  it('joins the family it is given rather than creating one', () => {
    // Orphan becomes a child of Henry's FIRST marriage specifically.
    link()('parent-child', { parentId: 'I1', childId: 'I6' }, 'F1');

    const model = useStore.getState().model!;
    expect(model.families.get('F1')!.childIds).toEqual(['I4', 'I6']);
    expect(model.families.has('FU1')).toBe(false);
    expect(useStore.getState().graph!.parentsOf.get('I6')!.sort()).toEqual([
      'I1',
      'I2',
    ]);
  });

  it('picks the other marriage when told to', () => {
    link()('parent-child', { parentId: 'I1', childId: 'I6' }, 'F2');

    const model = useStore.getState().model!;
    expect(model.families.get('F2')!.childIds).toEqual(['I5', 'I6']);
    expect(model.families.get('F1')!.childIds).toEqual(['I4']);
  });

  it('creates a new family when no id is given, as before', () => {
    link()('parent-child', { parentId: 'I1', childId: 'I6' });

    const model = useStore.getState().model!;
    expect(model.families.has('FU1')).toBe(true);
    expect(model.families.get('FU1')!.childIds).toEqual(['I6']);
    // The existing marriages are untouched.
    expect(model.families.get('F1')!.childIds).toEqual(['I4']);
  });

  it('adds a second parent to a family the child is already in', () => {
    // Elizabeth is in F2 with Henry and Anne; add nobody new, but prove the
    // join path works for a parent rather than a child.
    link()('parent-child', { parentId: 'I6', childId: 'I5' }, 'F2');

    expect(useStore.getState().model!.families.get('F2')!.spouseIds.sort()).toEqual([
      'I1',
      'I3',
      'I6',
    ]);
  });

  it('records the family it used in the op, so undo is exact', () => {
    link()('parent-child', { parentId: 'I1', childId: 'I6' }, 'F1');

    expect(useStore.getState().ops[0]).toMatchObject({
      kind: 'linkRelationship',
      familyId: 'F1',
    });

    useStore.getState().undoOp(0);
    expect(useStore.getState().model!.families.get('F1')!.childIds).toEqual(['I4']);
  });
});

describe('linkRelationship — blocking invalid links', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    useStore.getState().loadModel(parseGedcom(GED), 'link.ged');
    useStore.getState().setFocal('I1');
  });

  it('refuses a cycle, recording no op', () => {
    // Mary is Henry's daughter, so Henry cannot become Mary's child.
    link()('parent-child', { parentId: 'I4', childId: 'I1' });

    expect(useStore.getState().ops).toEqual([]);
    expect(useStore.getState().notice).toMatch(/own ancestor/i);
  });

  it('refuses making someone their own parent', () => {
    link()('parent-child', { parentId: 'I1', childId: 'I1' });

    expect(useStore.getState().ops).toEqual([]);
    expect(useStore.getState().notice).toMatch(/their own parent/i);
  });

  it('refuses marrying someone to themselves', () => {
    link()('spouse', { spouseAId: 'I1', spouseBId: 'I1' });

    expect(useStore.getState().ops).toEqual([]);
    expect(useStore.getState().notice).toMatch(/themselves/i);
  });

  it('blocks the create-and-attach path too, not just the new modal', () => {
    // The check lives in the store, so a caller that skips the modal is covered.
    // addPerson then link the new person as their own ancestor's parent.
    const id = useStore
      .getState()
      .addPerson({ nameRaws: ['New /Person/'], sex: 'male' })!;
    link()('parent-child', { parentId: id, childId: 'I1' });
    const opsAfterFirstLink = useStore.getState().ops.length;

    // Now the new person is Henry's parent; making Henry their parent is a cycle.
    link()('parent-child', { parentId: 'I1', childId: id });

    expect(useStore.getState().ops).toHaveLength(opsAfterFirstLink);
    expect(useStore.getState().notice).toMatch(/own ancestor/i);
  });

  it('allows a merely implausible link — warnings do not block', () => {
    link()('spouse', { spouseAId: 'I1', spouseBId: 'I4' });

    // Parent married to child is warned about in the UI, never refused here.
    expect(useStore.getState().ops).toHaveLength(1);
  });
});
