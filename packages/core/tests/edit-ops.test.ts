import { describe, it, expect } from 'vitest';
import { parseGedcom } from '../src/gedcom/parse.js';
import { buildGraph } from '../src/graph/build.js';
import { getAncestors } from '../src/graph/traversal.js';
import { applyOp, applyOps, type EditOp } from '../src/edit/ops.js';

// A child (I1) with a known mother (I2) and a duplicate mother (I2DUP).
const GED = `0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Child /Root/
1 SEX M
1 FAMC @F1@
0 @I2@ INDI
1 NAME Mother /Root/
1 SEX F
1 FAMS @F1@
0 @I2DUP@ INDI
1 NAME Mother /Root/
1 SEX F
0 @F1@ FAM
1 WIFE @I2@
1 CHIL @I1@
0 TRLR
`;

const at = '2026-06-23T00:00:00.000Z';

// A mixed op-log: add a person, link them as a parent, add a qualified+placed
// birth event, edit a person, and merge the duplicate. Exercises every op type.
const mixed: EditOp[] = [
  { kind: 'addPerson', personId: 'U1', nameRaws: ['Grandpa /New/'], sex: 'male', at },
  {
    kind: 'linkRelationship',
    relation: 'parent-child',
    familyId: 'UF1',
    parentId: 'U1',
    childId: 'I2',
    at,
  },
  {
    kind: 'addEvent',
    eventId: 'EVU1B',
    eventType: 'birth',
    participantIds: ['U1'],
    dateRaw: 'ABT 1700',
    placeRaw: 'Floyd, Kentucky, United States',
    at,
  },
  { kind: 'editPerson', personId: 'I1', notes: ['reviewed'], at },
  { kind: 'merge', keepId: 'I2', mergeId: 'I2DUP', at },
];

describe('edit op-log — applying each op type', () => {
  const base = parseGedcom(GED);
  const model = applyOps(base, mixed);

  it('addPerson creates a user-supplied person with parsed names', () => {
    const u1 = model.persons.get('U1')!;
    expect(u1.userSupplied).toBe(true);
    expect(u1.names[0]!.full).toBe('Grandpa New');
    expect(u1.names[0]!.isPrimary).toBe(true);
    expect(u1.sex).toBe('male');
    expect(u1.externalId).toBe('@U1@');
  });

  it('linkRelationship wires the family and both back-references', () => {
    const fam = model.families.get('UF1')!;
    expect(fam.userSupplied).toBe(true);
    expect(fam.spouseIds).toEqual(['U1']);
    expect(fam.childIds).toEqual(['I2']);
    expect(model.persons.get('U1')!.familyIdsAsSpouse).toContain('UF1');
    expect(model.persons.get('I2')!.familyIdAsChild).toBe('UF1');
  });

  it('addEvent round-trips the date qualifier and normalizes the place', () => {
    const ev = model.events.get('EVU1B')!;
    expect(ev.userSupplied).toBe(true);
    expect(ev.type).toBe('birth');
    expect(ev.date!.qualifier).toBe('about');
    expect(ev.date!.year).toBe(1700);
    expect(ev.place!.parts).toEqual(['Floyd', 'Kentucky', 'United States']);
    expect(ev.place!.normalized).toBe('floyd, kentucky, united states');
    expect(model.persons.get('U1')!.eventIds).toContain('EVU1B');
  });

  it('editPerson patches and flags the record user-supplied', () => {
    const p = model.persons.get('I1')!;
    expect(p.notes).toEqual(['reviewed']);
    expect(p.userSupplied).toBe(true);
  });

  it('merge folds the duplicate away', () => {
    expect(model.persons.has('I2DUP')).toBe(false);
  });

  it('the new links are visible to the derived graph', () => {
    const graph = buildGraph(model);
    expect(graph.parentsOf.get('I2')).toContain('U1');
    // I1's ancestors now climb through I2 up to the manually-added U1.
    expect(getAncestors(graph, 'I1')).toEqual(expect.arrayContaining(['I2', 'U1']));
  });

  it('never mutates the base model', () => {
    expect(base.persons.has('U1')).toBe(false);
    expect(base.persons.has('I2DUP')).toBe(true);
    expect(base.families.has('UF1')).toBe(false);
    expect(base.persons.get('I1')!.notes).toBeUndefined();
  });
});

describe('edit op-log — fidelity contract (handoff §8.2)', () => {
  const base = parseGedcom(GED);

  it('replaying the same op-log from base reproduces the exact model', () => {
    const a = applyOps(base, mixed);
    const b = applyOps(base, mixed);
    expect(a).toEqual(b);
  });

  it('is idempotent: re-applying an already-applied op is a no-op', () => {
    const once = applyOp(base, mixed[0]!); // addPerson U1
    const twice = applyOp(once, mixed[0]!); // same op again
    expect(twice).toEqual(once);
  });

  it('undo = drop the op and replay; redo = re-append and replay', () => {
    const full = applyOps(base, mixed);
    const undone = applyOps(base, mixed.slice(0, -1)); // drop the merge
    expect(undone.persons.has('I2DUP')).toBe(true); // merge reverted
    const redone = applyOps(base, mixed); // re-append → back to full
    expect(redone).toEqual(full);
  });

  it('skips ops whose referents are missing (resilient, no throw)', () => {
    const bad: EditOp[] = [
      {
        kind: 'linkRelationship',
        relation: 'parent-child',
        familyId: 'XF',
        parentId: 'GHOST',
        childId: 'NOPE',
        at,
      },
      { kind: 'editPerson', personId: 'GHOST', sex: 'female', at },
      { kind: 'addEvent', eventId: 'E', eventType: 'death', participantIds: ['GHOST'], at },
    ];
    const result = applyOps(base, bad);
    expect(result.families.has('XF')).toBe(false);
    // an addEvent whose participants are all missing still records the event but
    // attaches it to nobody — and crucially does not throw.
    expect(result.events.get('E')!.participants).toEqual([]);
  });
});

describe('edit op-log — unlink inverts a link', () => {
  it('removes an existing parent-child link and clears back-references', () => {
    const base = parseGedcom(GED);
    const unlinked = applyOps(base, [
      {
        kind: 'unlinkRelationship',
        relation: 'parent-child',
        familyId: 'F1',
        childId: 'I1',
        at,
      },
    ]);
    expect(unlinked.families.get('F1')!.childIds).not.toContain('I1');
    expect(unlinked.persons.get('I1')!.familyIdAsChild).toBeUndefined();
    // base untouched
    expect(base.families.get('F1')!.childIds).toContain('I1');
  });
});
