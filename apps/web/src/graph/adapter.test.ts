import { describe, it, expect } from 'vitest';
import type { GraphView, Person } from '@genealogy/core';
import { graphViewToFlow, edgeKey } from './adapter.js';

const person = (id: string): Person => ({
  id,
  externalId: `@${id}@`,
  names: [{ raw: `${id} /X/`, full: `${id} X`, isPrimary: true }],
  sex: 'unknown',
  eventIds: [],
  familyIdsAsSpouse: [],
  sources: [],
});

const view: GraphView = {
  focalPersonId: 'I1',
  nodes: [
    {
      person: person('I1'),
      generation: 0,
      isFocal: true,
      isPedigreeCollapsePoint: false,
      hasUnexpandedNeighbors: false,
    },
    {
      person: person('I2'),
      generation: 1,
      isFocal: false,
      isPedigreeCollapsePoint: true,
      hasUnexpandedNeighbors: true,
    },
  ],
  edges: [{ type: 'parentOf', from: 'I2', to: 'I1', familyId: 'F1' }],
};

describe('graphViewToFlow adapter', () => {
  it('maps every view node and edge with stable ids and flags', () => {
    const { nodes, edges } = graphViewToFlow(view);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(nodes[0]!.id).toBe('I1');
    expect(nodes[0]!.type).toBe('person');
    expect(nodes[0]!.data.isFocal).toBe(true);
    expect(nodes[1]!.data.isPedigreeCollapsePoint).toBe(true);
    expect(nodes[1]!.data.hasUnexpandedNeighbors).toBe(true);
    expect(edges[0]!.id).toBe('parentOf:I2->I1');
    expect(edges[0]!.source).toBe('I2');
    expect(edges[0]!.target).toBe('I1');
  });

  it('marks selection', () => {
    const { nodes } = graphViewToFlow(view, { selectedIds: new Set(['I2']) });
    expect(nodes.find((n) => n.id === 'I2')!.data.isSelected).toBe(true);
    expect(nodes.find((n) => n.id === 'I1')!.data.isSelected).toBe(false);
  });

  it('highlights nodes/edges on a path and dims the rest', () => {
    const { nodes, edges } = graphViewToFlow(view, {
      highlightedNodeIds: new Set(['I1']),
      highlightedEdgeKeys: new Set([edgeKey(view.edges[0]!)]),
      dimUnhighlighted: true,
    });
    expect(nodes.find((n) => n.id === 'I1')!.data.isHighlighted).toBe(true);
    expect(nodes.find((n) => n.id === 'I2')!.data.isDimmed).toBe(true);
    expect(edges[0]!.animated).toBe(true);
  });
});
