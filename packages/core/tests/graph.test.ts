import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGedcom } from '../src/gedcom/parse.js';
import { buildGraph } from '../src/graph/build.js';
import { getAncestors, getDescendants } from '../src/graph/traversal.js';
import { computeGenerations } from '../src/graph/generations.js';

function model(name: string) {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return parseGedcom(readFileSync(fileURLToPath(url), 'utf-8'));
}

describe('buildGraph — minimal.ged', () => {
  const g = buildGraph(model('minimal.ged'));

  it('derives parent/child adjacency from families', () => {
    expect(g.parentsOf.get('I3')!.sort()).toEqual(['I1', 'I2']);
    expect(g.childrenOf.get('I1')).toEqual(['I3']);
    expect(g.childrenOf.get('I2')).toEqual(['I3']);
  });

  it('derives spouse adjacency (both directions)', () => {
    expect(g.spousesOf.get('I1')).toEqual(['I2']);
    expect(g.spousesOf.get('I2')).toEqual(['I1']);
  });

  it('emits parentOf and spouseOf edges carrying their familyId', () => {
    const parentEdges = g.edges.filter((e) => e.type === 'parentOf');
    const spouseEdges = g.edges.filter((e) => e.type === 'spouseOf');
    expect(parentEdges).toHaveLength(2);
    expect(spouseEdges).toHaveLength(1);
    expect(parentEdges.every((e) => e.familyId === 'F1')).toBe(true);
    // spouseOf stored once with stable (sorted) ordering
    expect(spouseEdges[0]).toMatchObject({ from: 'I1', to: 'I2', familyId: 'F1' });
  });

  it('is deterministic for identical input', () => {
    const g2 = buildGraph(model('minimal.ged'));
    expect(g2.edges).toEqual(g.edges);
  });
});

describe('buildGraph — dangling pointers yield no edge (broken.ged)', () => {
  const g = buildGraph(model('broken.ged'));
  it('skips edges to missing persons', () => {
    // F1 lists CHIL @I98@ which does not exist → no parent edge to I98.
    const childIds = g.edges.filter((e) => e.type === 'parentOf').map((e) => e.to);
    expect(childIds).not.toContain('I98');
    // I3 is a real child of F1 → edges exist.
    expect(g.parentsOf.get('I3')!.sort()).toEqual(['I1', 'I2']);
    // F2 references missing husband @I97@ → no spouse edge involving I97.
    expect([...g.spousesOf.keys()]).not.toContain('I97');
  });
});

describe('traversal — multiple-marriages.ged', () => {
  const g = buildGraph(model('multiple-marriages.ged'));
  it('getDescendants spans both marriages', () => {
    expect(getDescendants(g, 'I1').sort()).toEqual(['I4', 'I5', 'I6']);
  });
  it('getAncestors of a half-sibling reaches the shared parent', () => {
    expect(getAncestors(g, 'I6')).toContain('I1');
    expect(getAncestors(g, 'I6')).toContain('I3');
  });
  it('respects a generations cap', () => {
    expect(getAncestors(g, 'I4', 1).sort()).toEqual(['I1', 'I2']);
  });
});

describe('generations & collapse depth — pedigree-collapse.ged', () => {
  const g = buildGraph(model('pedigree-collapse.ged'));

  it('getAncestors of focal returns all 10 ancestors, deduplicated', () => {
    const anc = getAncestors(g, 'I11');
    expect(new Set(anc).size).toBe(anc.length); // no duplicates
    expect(anc.sort()).toEqual(
      ['I1', 'I10', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9'].sort(),
    );
  });

  it('computeGenerations records the focal at 0 and parents at 1', () => {
    const gens = computeGenerations(g, 'I11');
    expect(gens.get('I11')).toBe(0);
    expect(gens.get('I7')).toBe(1);
    expect(gens.get('I10')).toBe(1);
    expect(gens.get('I3')).toBe(2);
    expect(gens.get('I8')).toBe(2);
  });

  it('records a pedigree-collapse ancestor at its MINIMUM depth', () => {
    const gens = computeGenerations(g, 'I11');
    // Alfred (@I1@) is reachable at depth 3 (paternal) and 4 (maternal) → min 3.
    expect(gens.get('I1')).toBe(3);
    expect(gens.get('I2')).toBe(3);
  });
});
