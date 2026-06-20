import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGedcom } from '../src/gedcom/parse.js';
import { buildGraph } from '../src/graph/build.js';
import { getEgoNetwork } from '../src/graph/ego-network.js';
import { expandPerson } from '../src/graph/expand.js';
import type { GraphView } from '../src/types/graph.js';

function modelOf(name: string) {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return parseGedcom(readFileSync(fileURLToPath(url), 'utf-8'));
}

const nodeIds = (view: GraphView): string[] =>
  view.nodes.map((n) => n.person.id).sort();
const nodeFor = (view: GraphView, id: string) =>
  view.nodes.find((n) => n.person.id === id);
const everyEdgeInternal = (view: GraphView): boolean => {
  const ids = new Set(view.nodes.map((n) => n.person.id));
  return view.edges.every((e) => ids.has(e.from) && ids.has(e.to));
};

describe('getEgoNetwork — pedigree-collapse.ged (focal I11)', () => {
  const model = modelOf('pedigree-collapse.ged');
  const graph = buildGraph(model);

  it('default options include all 11 persons with focal-relative generations', () => {
    const view = getEgoNetwork(graph, model, 'I11');
    expect(nodeIds(view)).toEqual(
      ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'I10', 'I11'].sort(),
    );

    const focal = nodeFor(view, 'I11')!;
    expect(focal.isFocal).toBe(true);
    expect(focal.generation).toBe(0);

    expect(nodeFor(view, 'I7')!.generation).toBe(1);
    expect(nodeFor(view, 'I3')!.generation).toBe(2);
    expect(nodeFor(view, 'I1')!.generation).toBe(3);
  });

  it('marks I1 and I2 as pedigree-collapse points, a normal ancestor not', () => {
    const view = getEgoNetwork(graph, model, 'I11');
    expect(nodeFor(view, 'I1')!.isPedigreeCollapsePoint).toBe(true);
    expect(nodeFor(view, 'I2')!.isPedigreeCollapsePoint).toBe(true);
    expect(nodeFor(view, 'I3')!.isPedigreeCollapsePoint).toBe(false);
    expect(nodeFor(view, 'I11')!.isPedigreeCollapsePoint).toBe(false);
  });

  it('emits only edges whose endpoints are both included', () => {
    const view = getEgoNetwork(graph, model, 'I11');
    expect(everyEdgeInternal(view)).toBe(true);
    expect(view.focalPersonId).toBe('I11');
  });

  it('ancestorGenerations:1 yields exactly {I11, I7, I10} with spouse + parent edges', () => {
    const view = getEgoNetwork(graph, model, 'I11', { ancestorGenerations: 1 });
    expect(nodeIds(view)).toEqual(['I10', 'I11', 'I7']);

    // I7's parents are excluded, so it has unexpanded neighbors.
    expect(nodeFor(view, 'I7')!.hasUnexpandedNeighbors).toBe(true);

    const hasEdge = (type: string, from: string, to: string): boolean =>
      view.edges.some((e) => e.type === type && e.from === from && e.to === to);
    // Two parentOf edges (I7 -> I11 and I10 -> I11).
    expect(hasEdge('parentOf', 'I7', 'I11')).toBe(true);
    expect(hasEdge('parentOf', 'I10', 'I11')).toBe(true);
    // The spouseOf edge between the two parents (stored from = smaller id).
    expect(hasEdge('spouseOf', 'I10', 'I7')).toBe(true);
    expect(everyEdgeInternal(view)).toBe(true);
  });

  it('nodeBudget:2 truncates to 2 nodes, leaving unexpanded neighbors', () => {
    const view = getEgoNetwork(graph, model, 'I11', { nodeBudget: 2 });
    expect(view.nodes).toHaveLength(2);
    // Focal survives truncation.
    expect(nodeFor(view, 'I11')).toBeDefined();
    expect(view.nodes.some((n) => n.hasUnexpandedNeighbors)).toBe(true);
    expect(everyEdgeInternal(view)).toBe(true);
  });
});

describe('getEgoNetwork — cousins.ged descendant view (focal I1)', () => {
  const model = modelOf('cousins.ged');
  const graph = buildGraph(model);

  it('descendantGenerations:2 with ancestorGenerations:0 gives negative gens', () => {
    const view = getEgoNetwork(graph, model, 'I1', {
      ancestorGenerations: 0,
      descendantGenerations: 2,
    });
    expect(nodeFor(view, 'I1')!.generation).toBe(0);
    // Children: I3, I4 at gen -1.
    expect(nodeFor(view, 'I3')!.generation).toBe(-1);
    expect(nodeFor(view, 'I4')!.generation).toBe(-1);
    // Grandchildren: I7 (child of I3), I8 (child of I4) at gen -2, present.
    expect(nodeFor(view, 'I7')!.generation).toBe(-2);
    expect(nodeFor(view, 'I8')!.generation).toBe(-2);
    expect(everyEdgeInternal(view)).toBe(true);
  });
});

describe('expandPerson — from the I11 ancestorGenerations:1 view', () => {
  const model = modelOf('pedigree-collapse.ged');
  const graph = buildGraph(model);

  it('expanding I7 ancestors adds its parents I3 and I5 with connecting edges', () => {
    const view = getEgoNetwork(graph, model, 'I11', { ancestorGenerations: 1 });
    const existing = new Set(view.nodes.map((n) => n.person.id));

    const { addedNodes, addedEdges } = expandPerson(
      graph,
      model,
      view,
      'I7',
      'ancestors',
    );

    const addedIds = addedNodes.map((n) => n.person.id).sort();
    expect(addedIds).toEqual(['I3', 'I5']);
    // I7 is at gen 1 in the view, so its parents are at gen 2.
    expect(addedNodes.every((n) => n.generation === 2)).toBe(true);
    // None of the added nodes were already in the view.
    expect(addedNodes.every((n) => !existing.has(n.person.id))).toBe(true);

    const hasEdge = (from: string, to: string): boolean =>
      addedEdges.some((e) => e.type === 'parentOf' && e.from === from && e.to === to);
    expect(hasEdge('I3', 'I7')).toBe(true);
    expect(hasEdge('I5', 'I7')).toBe(true);
    // The spouse edge between the newly added I3 and I5 is also connected.
    expect(
      addedEdges.some((e) => e.type === 'spouseOf' && e.from === 'I3' && e.to === 'I5'),
    ).toBe(true);
  });
});
