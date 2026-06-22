import { describe, it, expect } from 'vitest';
import { parseGedcom } from '../src/gedcom/parse.js';
import { mergePersons, applyMerges } from '../src/edit/merge.js';

// Two duplicate spouses in separate families, each with one event.
const DUP_GED = `0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME John /Smith/
1 SEX M
1 BIRT
2 DATE 1850
1 FAMS @F1@
1 FAMC @F3@
0 @I2@ INDI
1 NAME Johnny /Smith/
1 SEX U
1 DEAT
2 DATE 1910
1 FAMS @F2@
0 @W1@ INDI
1 NAME Wife /One/
1 SEX F
0 @W2@ INDI
1 NAME Wife /Two/
1 SEX F
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @W1@
0 @F2@ FAM
1 HUSB @I2@
1 WIFE @W2@
0 @F3@ FAM
1 CHIL @I1@
0 TRLR
`;

describe('mergePersons — folding duplicate records', () => {
  const base = parseGedcom(DUP_GED);
  const birthId = base.persons.get('I1')!.eventIds[0]!;
  const deathId = base.persons.get('I2')!.eventIds[0]!;
  const merged = mergePersons(base, 'I1', 'I2');

  it('does not mutate the input model', () => {
    expect(base.persons.has('I2')).toBe(true);
    expect(base.persons.get('I1')!.familyIdsAsSpouse).toEqual(['F1']);
  });

  it('removes the absorbed record and records provenance', () => {
    expect(merged.persons.has('I2')).toBe(false);
    expect(merged.persons.get('I1')!.mergedFromIds).toEqual(['I2']);
  });

  it("keeps the target's primary name and adds the other as an alternate", () => {
    const names = merged.persons.get('I1')!.names;
    expect(names[0]!.full).toBe('John Smith');
    expect(names[0]!.isPrimary).toBe(true);
    expect(names.map((n) => n.full)).toContain('Johnny Smith');
    expect(names.find((n) => n.full === 'Johnny Smith')!.isPrimary).toBe(false);
  });

  it('fills sex from the source when the target is unknown', () => {
    // target is M, source is U → stays M
    expect(merged.persons.get('I1')!.sex).toBe('male');
    // reverse direction: target U, source M → becomes M
    expect(mergePersons(base, 'I2', 'I1').persons.get('I2')!.sex).toBe('male');
  });

  it('unions events and spouse-families and keeps the FAMC', () => {
    const p = merged.persons.get('I1')!;
    expect(p.eventIds).toEqual(expect.arrayContaining([birthId, deathId]));
    expect(p.familyIdsAsSpouse).toEqual(['F1', 'F2']);
    expect(p.familyIdAsChild).toBe('F3');
  });

  it('rewrites family spouse links and event participants to the kept id', () => {
    expect(merged.families.get('F2')!.spouseIds).toEqual(['I1', 'W2']);
    const death = [...merged.events.values()].find((e) => e.id === deathId)!;
    expect(death.participants).toEqual(['I1']);
  });
});

describe('mergePersons — degenerate topologies', () => {
  it('collapses two spouses of the same family into one', () => {
    const ged = `0 HEAD
0 @I1@ INDI
1 NAME A /X/
1 FAMS @F1@
0 @I2@ INDI
1 NAME B /X/
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
0 TRLR
`;
    const merged = mergePersons(parseGedcom(ged), 'I1', 'I2');
    expect(merged.families.get('F1')!.spouseIds).toEqual(['I1']);
  });

  it('never makes a person their own parent (parent↔child merge)', () => {
    const ged = `0 HEAD
0 @I1@ INDI
1 NAME Parent /X/
1 FAMS @F1@
0 @I2@ INDI
1 NAME Child /X/
1 FAMC @F1@
0 @W1@ INDI
1 NAME Spouse /Y/
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @W1@
1 CHIL @I2@
0 TRLR
`;
    // Fold the parent (I1) into the child (I2): I2 survives.
    const merged = mergePersons(parseGedcom(ged), 'I2', 'I1');
    const fam = merged.families.get('F1')!;
    expect(fam.spouseIds).toContain('I2');
    expect(fam.childIds).not.toContain('I2'); // self-loop removed
    expect(merged.persons.get('I2')!.familyIdAsChild).toBeUndefined();
  });
});

describe('applyMerges — replay', () => {
  const base = parseGedcom(DUP_GED);

  it('equals a direct merge for a single op', () => {
    const replayed = applyMerges(base, [{ keepId: 'I1', mergeId: 'I2', at: 't' }]);
    expect(replayed.persons.has('I2')).toBe(false);
    expect(replayed.persons.get('I1')!.familyIdsAsSpouse).toEqual(['F1', 'F2']);
  });

  it('skips ops whose records no longer exist (resilient, no throw)', () => {
    const ops = [
      { keepId: 'I1', mergeId: 'I2', at: 't1' },
      { keepId: 'I1', mergeId: 'I2', at: 't2' }, // I2 already gone
      { keepId: 'I1', mergeId: 'NOPE', at: 't3' },
    ];
    const result = applyMerges(base, ops);
    expect(result.persons.has('I2')).toBe(false);
    expect(result.persons.has('I1')).toBe(true);
    // base untouched
    expect(base.persons.has('I2')).toBe(true);
  });
});
