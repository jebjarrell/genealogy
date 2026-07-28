import { describe, it, expect } from 'vitest';
import { parseGedcom } from '../src/gedcom/parse.js';
import { buildGraph } from '../src/graph/build.js';
import { applyOps } from '../src/edit/ops.js';
import { coParentsOf, findParentChildFamily } from '../src/graph/family-link.js';

// The situation this exists for: a GEDCOM where someone was attached a
// generation too high, so a child ends up listed under two different couples.
// Removing the wrong link needs the FAM that carries it, because GEDCOM models
// parent-child THROUGH a family rather than as a direct edge.
//
//   F1: Thomas + Mary   -> James          (correct: Thomas is the father)
//   F2: Ezekiel + Sarah -> James, Nancy   (wrong: Ezekiel is the grandfather)
const TWO_FATHERS = `0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Thomas L /Stone/
1 SEX M
0 @I2@ INDI
1 NAME Mary /Stone/
1 SEX F
0 @I3@ INDI
1 NAME Ezekiel M /Stone/
1 SEX M
0 @I4@ INDI
1 NAME Sarah /Stone/
1 SEX F
0 @I5@ INDI
1 NAME James Edward /Stone/
1 SEX M
1 FAMC @F1@
1 FAMC @F2@
0 @I6@ INDI
1 NAME Nancy /Stone/
1 SEX F
1 FAMC @F2@
0 @I7@ INDI
1 NAME Solo /Stone/
1 SEX M
1 FAMC @F3@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I5@
0 @F2@ FAM
1 HUSB @I3@
1 WIFE @I4@
1 CHIL @I5@
1 CHIL @I6@
0 @F3@ FAM
1 HUSB @I1@
1 CHIL @I7@
0 TRLR
`;

describe('findParentChildFamily', () => {
  const graph = buildGraph(parseGedcom(TWO_FATHERS));

  it('finds the family carrying a given parent-child link', () => {
    expect(findParentChildFamily(graph, 'I1', 'I5')).toBe('F1');
    expect(findParentChildFamily(graph, 'I3', 'I5')).toBe('F2');
  });

  it('distinguishes the two families one child appears in', () => {
    // The whole point: same child, different fathers, different FAM records.
    expect(findParentChildFamily(graph, 'I1', 'I5')).not.toBe(
      findParentChildFamily(graph, 'I3', 'I5'),
    );
  });

  it('finds the link for a co-parent, and for a sibling in the same family', () => {
    expect(findParentChildFamily(graph, 'I4', 'I5')).toBe('F2');
    expect(findParentChildFamily(graph, 'I3', 'I6')).toBe('F2');
  });

  it('resolves the right family when one parent has children in two of them', () => {
    // Thomas parents James in F1 and Solo in F3.
    expect(findParentChildFamily(graph, 'I1', 'I5')).toBe('F1');
    expect(findParentChildFamily(graph, 'I1', 'I7')).toBe('F3');
  });

  it('returns null when the two people are not parent and child', () => {
    expect(findParentChildFamily(graph, 'I5', 'I1')).toBeNull(); // reversed
    expect(findParentChildFamily(graph, 'I1', 'I6')).toBeNull(); // unrelated
    expect(findParentChildFamily(graph, 'I1', 'NOPE')).toBeNull();
  });
});

describe('coParentsOf', () => {
  const model = parseGedcom(TWO_FATHERS);

  it('lists the other parents a child would also be detached from', () => {
    // Detaching James from F2 removes Ezekiel AND Sarah as his parents, because
    // GEDCOM attaches a child to the couple, not to one person. The UI has to
    // say so before the user confirms.
    expect(coParentsOf(model, 'F2', 'I3')).toEqual(['I4']);
    expect(coParentsOf(model, 'F1', 'I1')).toEqual(['I2']);
  });

  it('is empty when the family records only one parent', () => {
    expect(coParentsOf(model, 'F3', 'I1')).toEqual([]);
  });

  it('is empty for an unknown family', () => {
    expect(coParentsOf(model, 'NOPE', 'I1')).toEqual([]);
  });
});

describe('detaching a child from one of two families', () => {
  const base = parseGedcom(TWO_FATHERS);
  const familyId = findParentChildFamily(buildGraph(base), 'I3', 'I5')!;
  const after = applyOps(base, [
    {
      kind: 'unlinkRelationship',
      relation: 'parent-child',
      familyId,
      childId: 'I5',
      at: '2026-07-28T00:00:00.000Z',
    },
  ]);
  const graph = buildGraph(after);

  it('severs the wrong father and his wife, and only them', () => {
    expect(graph.parentsOf.get('I5')!.sort()).toEqual(['I1', 'I2']);
  });

  it('leaves the correct father intact', () => {
    expect(findParentChildFamily(graph, 'I1', 'I5')).toBe('F1');
  });

  it('leaves the wrong father his other children', () => {
    // Nancy really is Ezekiel's daughter and must not be collateral damage.
    expect(graph.childrenOf.get('I3')).toEqual(['I6']);
    expect(after.families.get('F2')!.childIds).toEqual(['I6']);
  });

  it('keeps the parents themselves in the family', () => {
    expect(after.families.get('F2')!.spouseIds.sort()).toEqual(['I3', 'I4']);
  });

  it('does not disturb the FAMC pointer to the family it kept', () => {
    expect(after.persons.get('I5')!.familyIdAsChild).toBe('F1');
  });

  it('leaves the base model untouched', () => {
    expect(base.families.get('F2')!.childIds).toContain('I5');
  });
});
