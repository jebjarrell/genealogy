import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGedcom } from '../src/gedcom/parse.js';
import {
  candidateFamiliesForChild,
  candidateFamiliesForParent,
  candidateFamiliesForSpouse,
} from '../src/edit/link-targets.js';

function model(name: string) {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return parseGedcom(readFileSync(fileURLToPath(url), 'utf-8'));
}

// multiple-marriages.ged:
//   F1: Henry (I1) + Catherine (I2) -> Mary (I4), Edward (I5)
//   F2: Henry (I1) + Anne (I3)      -> Elizabeth (I6)
// Henry is the ambiguous case: a new child of his could belong to either
// marriage, and guessing produces a wrong tree.
const m = model('multiple-marriages.ged');

describe('candidateFamiliesForChild — where could a new child of this person go?', () => {
  it('returns both marriages for a twice-married parent', () => {
    const candidates = candidateFamiliesForChild(m, 'I1');
    expect(candidates.map((c) => c.familyId)).toEqual(['F1', 'F2']);
  });

  it('carries the members, so the chooser can describe each option', () => {
    const [first, second] = candidateFamiliesForChild(m, 'I1');
    expect(first!.spouseIds.sort()).toEqual(['I1', 'I2']);
    expect(first!.childIds).toEqual(['I4', 'I5']);
    expect(second!.spouseIds.sort()).toEqual(['I1', 'I3']);
    expect(second!.childIds).toEqual(['I6']);
  });

  it('returns the single marriage for a once-married parent', () => {
    expect(candidateFamiliesForChild(m, 'I2').map((c) => c.familyId)).toEqual(['F1']);
  });

  it('returns nothing for someone who is nobody’s spouse', () => {
    // Mary is a child in F1 but heads no family of her own yet.
    expect(candidateFamiliesForChild(m, 'I4')).toEqual([]);
  });

  it('returns nothing for an unknown person', () => {
    expect(candidateFamiliesForChild(m, 'NOPE')).toEqual([]);
  });
});

describe('candidateFamiliesForParent — where could a new parent of this person go?', () => {
  it('returns the family the child already belongs to', () => {
    const candidates = candidateFamiliesForParent(m, 'I4');
    expect(candidates.map((c) => c.familyId)).toEqual(['F1']);
    expect(candidates[0]!.spouseIds.sort()).toEqual(['I1', 'I2']);
  });

  it('returns nothing for someone with no recorded parents', () => {
    // Henry heads two families but is not a child in any.
    expect(candidateFamiliesForParent(m, 'I1')).toEqual([]);
  });

  it('returns nothing for an unknown person', () => {
    expect(candidateFamiliesForParent(m, 'NOPE')).toEqual([]);
  });
});

describe('candidate families derive from the family records, not the person pointers', () => {
  // Person.familyIdAsChild is singular, so a child in two families has a pointer
  // to only one of them. The lists must still find both, or the second parent
  // family becomes unreachable from the UI.
  const TWO_FAMILIES = `0 HEAD
0 @I1@ INDI
1 NAME Father /One/
0 @I2@ INDI
1 NAME Father /Two/
0 @I3@ INDI
1 NAME Disputed /Child/
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 CHIL @I3@
0 @F2@ FAM
1 HUSB @I2@
1 CHIL @I3@
0 TRLR
`;
  const two = parseGedcom(TWO_FAMILIES);

  it('finds both families a child appears in, despite the single FAMC pointer', () => {
    expect(two.persons.get('I3')!.familyIdAsChild).toBe('F1');
    expect(candidateFamiliesForParent(two, 'I3').map((c) => c.familyId)).toEqual([
      'F1',
      'F2',
    ]);
  });
});

describe('candidateFamiliesForSpouse — where could a new spouse go?', () => {
  it('never offers a marriage that already has two spouses', () => {
    // Adding a spouse to Henry's existing marriage would make a three-spouse
    // family and silently record the newcomer as a parent of its children.
    expect(candidateFamiliesForSpouse(m, 'I1')).toEqual([]);
    expect(candidateFamiliesForSpouse(m, 'I2')).toEqual([]);
  });

  it('offers a family that records only one spouse so far', () => {
    // A FAM with a father and children but no mother yet: adding her belongs
    // in that family, not a new one.
    const LONE_PARENT = `0 HEAD
0 @I1@ INDI
1 NAME Widower /Alone/
0 @I2@ INDI
1 NAME Missing /Wife/
0 @I3@ INDI
1 NAME Their /Child/
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 CHIL @I3@
0 TRLR
`;
    const lone = parseGedcom(LONE_PARENT);
    const candidates = candidateFamiliesForSpouse(lone, 'I1');
    expect(candidates.map((c) => c.familyId)).toEqual(['F1']);
    expect(candidates[0]!.childIds).toEqual(['I3']);
  });

  it('offers nothing for someone in no family at all', () => {
    expect(candidateFamiliesForSpouse(m, 'I4')).toEqual([]);
  });
});
