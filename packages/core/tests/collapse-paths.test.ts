import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGedcom } from '../src/gedcom/parse.js';
import { buildGraph } from '../src/graph/build.js';
import { enumeratePaths } from '../src/graph/paths.js';
import { detectPedigreeCollapse } from '../src/graph/collapse.js';
import { findCommonAncestors } from '../src/graph/common-ancestors.js';
import type { Graph, GraphEdge, Path } from '../src/types/graph.js';

function model(name: string) {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return parseGedcom(readFileSync(fileURLToPath(url), 'utf-8'));
}
const graphOf = (name: string) => buildGraph(model(name));

/** Build a graph directly from a list of [parent, child] edges (for cap tests). */
function makeGraph(parentEdges: Array<[string, string]>): Graph {
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  const edges: GraphEdge[] = [];
  for (const [parent, child] of parentEdges) {
    (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(child);
    (parentsOf.get(child) ?? parentsOf.set(child, []).get(child)!).push(parent);
    edges.push({ type: 'parentOf', from: parent, to: child, familyId: 'F' });
  }
  return { parentsOf, childrenOf, spousesOf: new Map(), edges };
}

const idSeq = (p: Path) => p.steps.map((s) => s.personId).join('>');
const idSeqSet = (paths: Path[]) => new Set(paths.map(idSeq));

describe('enumeratePaths — pedigree-collapse.ged (the documented acceptance gate)', () => {
  const g = graphOf('pedigree-collapse.ged');

  it('finds EXACTLY the two documented paths from Paul to Alfred (@I1@)', () => {
    const paths = enumeratePaths(g, 'I11', 'I1');
    expect(paths).toHaveLength(2);
    expect(idSeqSet(paths)).toEqual(new Set(['I11>I7>I3>I1', 'I11>I10>I8>I4>I1']));
    expect(paths.map((p) => p.length).sort()).toEqual([3, 4]);
  });

  it('finds EXACTLY the two documented paths from Paul to Bertha (@I2@)', () => {
    const paths = enumeratePaths(g, 'I11', 'I2');
    expect(paths).toHaveLength(2);
    expect(idSeqSet(paths)).toEqual(new Set(['I11>I7>I3>I2', 'I11>I10>I8>I4>I2']));
  });

  it('labels every hop as a parentOf edge with a terminal step', () => {
    const [p] = enumeratePaths(g, 'I11', 'I1');
    expect(p!.steps[0]!.edgeToNext).toBe('parentOf');
    expect(p!.steps.at(-1)!.edgeToNext).toBeUndefined();
  });

  it('does not produce zig-zag artifact paths to a non-ancestor sibling line', () => {
    // Edith (@I5@, an outsider spouse) is reachable from Paul only down-then... she
    // is an ancestor (grandmother via George), exactly one path; no spurious routes.
    const paths = enumeratePaths(g, 'I11', 'I5');
    expect(idSeqSet(paths)).toEqual(new Set(['I11>I7>I5']));
  });
});

describe('detectPedigreeCollapse', () => {
  it('identifies exactly the two collapse ancestors on pedigree-collapse.ged', () => {
    const points = detectPedigreeCollapse(graphOf('pedigree-collapse.ged'), 'I11');
    expect(points.map((p) => p.ancestorId).sort()).toEqual(['I1', 'I2']);
    for (const point of points) {
      expect(point.pathCount).toBe(2);
      expect(point.paths).toHaveLength(2);
      expect(point.paths.map((p) => p.length).sort()).toEqual([3, 4]);
    }
  });

  it('reports NO collapse on a clean tree (minimal.ged) — no false positives', () => {
    expect(detectPedigreeCollapse(graphOf('minimal.ged'), 'I3')).toEqual([]);
  });
});

describe('findCommonAncestors', () => {
  const g = graphOf('pedigree-collapse.ged');
  it('finds the ancestral couple as MRCAs of the two cousins, with distances', () => {
    const common = findCommonAncestors(g, 'I7', 'I10');
    expect(common.map((c) => c.ancestorId).sort()).toEqual(['I1', 'I2']);
    const alfred = common.find((c) => c.ancestorId === 'I1')!;
    // George (@I7@) is Alfred's grandson (2); Helen (@I10@) is his great-grandchild (3).
    expect(alfred.generationsFromA).toBe(2);
    expect(alfred.generationsFromB).toBe(3);
    expect(alfred.pathsFromA[0]!.length).toBe(2);
    expect(alfred.pathsFromB[0]!.length).toBe(3);
  });
});

describe('path-enumeration caps (TRD §7.3 — mandatory guard)', () => {
  // A chain of three "diamonds": n0 -> {a1,b1} -> m1 -> {a2,b2} -> m2 -> {a3,b3} -> m3.
  // Distinct simple upward paths n0 -> m3 = 2 * 2 * 2 = 8.
  const diamonds = makeGraph([
    ['a1', 'n0'],
    ['b1', 'n0'],
    ['m1', 'a1'],
    ['m1', 'b1'],
    ['a2', 'm1'],
    ['b2', 'm1'],
    ['m2', 'a2'],
    ['m2', 'b2'],
    ['a3', 'm2'],
    ['b3', 'm2'],
    ['m3', 'a3'],
    ['m3', 'b3'],
  ]);

  it('enumerates all 8 paths when uncapped', () => {
    expect(enumeratePaths(diamonds, 'n0', 'm3')).toHaveLength(8);
  });

  it('truncates to maxPaths', () => {
    expect(enumeratePaths(diamonds, 'n0', 'm3', { maxPaths: 5 })).toHaveLength(5);
  });

  it('respects maxDepth (m3 is 6 edges up; unreachable within 5)', () => {
    expect(enumeratePaths(diamonds, 'n0', 'm3', { maxDepth: 5 })).toHaveLength(0);
    expect(enumeratePaths(diamonds, 'n0', 'm3', { maxDepth: 6 })).toHaveLength(8);
  });

  it('detectPedigreeCollapse caps paths per ancestor and flags truncation', () => {
    const uncapped = detectPedigreeCollapse(diamonds, 'n0');
    const m3 = uncapped.find((p) => p.ancestorId === 'm3')!;
    expect(m3.pathCount).toBe(8);
    expect(m3.truncated ?? false).toBe(false);

    const capped = detectPedigreeCollapse(diamonds, 'n0', { maxPathsPerAncestor: 5 });
    const m3c = capped.find((p) => p.ancestorId === 'm3')!;
    expect(m3c.paths).toHaveLength(5);
    expect(m3c.truncated).toBe(true);
  });
});
