import { describe, it, expect } from 'vitest';
import { parseGedcom, buildGraph } from '@genealogy/core';
import cousinsGed from '../../../../packages/core/tests/fixtures/cousins.ged?raw';
import pedigreeGed from '../../../../packages/core/tests/fixtures/pedigree-collapse.ged?raw';
import { focalGenerations, pathsToHighlight, buildView } from './viewModel.js';

const graphOf = (ged: string) => {
  const model = parseGedcom(ged);
  return { model, graph: buildGraph(model) };
};

describe('viewModel.focalGenerations', () => {
  it('numbers ancestors positive and descendants negative around the focal', () => {
    const { graph } = graphOf(cousinsGed);
    // Focal I7 (Carl): parent I3 = +1, grandparent I1 = +2, child I11 = -1.
    const gen = focalGenerations(graph, 'I7');
    expect(gen.get('I7')).toBe(0);
    expect(gen.get('I3')).toBe(1);
    expect(gen.get('I1')).toBe(2);
    expect(gen.get('I11')).toBe(-1);
  });
});

describe('viewModel.buildView', () => {
  it('induces edges among included nodes and flags unexpanded neighbours', () => {
    const { model, graph } = graphOf(pedigreeGed);
    const gen = focalGenerations(graph, 'I11');
    const ids = new Set(['I11', 'I7', 'I10']); // focal + parents only
    const view = buildView(graph, model, 'I11', new Set(), gen, ids);
    expect(view.nodes).toHaveLength(3);
    expect(view.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
    expect(view.nodes.find((n) => n.person.id === 'I7')!.hasUnexpandedNeighbors).toBe(
      true,
    );
  });
});

describe('viewModel.pathsToHighlight', () => {
  it('collects path node ids and both edge orientations', () => {
    const { nodeIds, edgeKeys } = pathsToHighlight([
      {
        length: 2,
        steps: [
          { personId: 'A', edgeToNext: 'parentOf' },
          { personId: 'B', edgeToNext: 'parentOf' },
          { personId: 'C' },
        ],
      },
    ]);
    expect([...nodeIds].sort()).toEqual(['A', 'B', 'C']);
    expect(edgeKeys.has('parentOf:A->B')).toBe(true);
    expect(edgeKeys.has('parentOf:B->A')).toBe(true);
  });
});
