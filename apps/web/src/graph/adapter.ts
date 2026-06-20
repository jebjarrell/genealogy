import type { Edge, Node } from '@xyflow/react';
import type { GraphEdge, GraphView, Person } from '@genealogy/core';

// The renderer adapter (TRD §10.2): the ONLY place that knows React Flow's
// shapes. It maps core's library-agnostic GraphView to React Flow nodes/edges;
// core data structures stay free of any rendering-library coupling.

export interface PersonNodeData extends Record<string, unknown> {
  person: Person;
  generation?: number;
  isFocal: boolean;
  isPedigreeCollapsePoint: boolean;
  hasUnexpandedNeighbors: boolean;
  isSelected: boolean;
  /** On a currently highlighted relationship path. */
  isHighlighted: boolean;
  /** Dimmed because a highlight is active and this node is not on it. */
  isDimmed: boolean;
}

export type PersonFlowNode = Node<PersonNodeData, 'person'>;

export const edgeKey = (e: Pick<GraphEdge, 'type' | 'from' | 'to'>): string =>
  `${e.type}:${e.from}->${e.to}`;

export interface AdapterOptions {
  selectedIds?: ReadonlySet<string>;
  /** Node ids that lie on a highlighted relationship path. */
  highlightedNodeIds?: ReadonlySet<string>;
  /** Edge keys that lie on a highlighted relationship path. */
  highlightedEdgeKeys?: ReadonlySet<string>;
  /** When true, nodes/edges not highlighted are marked dimmed. */
  dimUnhighlighted?: boolean;
}

export function graphViewToFlow(
  view: GraphView,
  options: AdapterOptions = {},
): { nodes: PersonFlowNode[]; edges: Edge[] } {
  const {
    selectedIds,
    highlightedNodeIds,
    highlightedEdgeKeys,
    dimUnhighlighted = false,
  } = options;

  const nodes: PersonFlowNode[] = view.nodes.map((vn) => {
    const id = vn.person.id;
    const isHighlighted = highlightedNodeIds?.has(id) ?? false;
    return {
      id,
      type: 'person',
      position: { x: 0, y: 0 }, // filled in by the dagre layout pass
      data: {
        person: vn.person,
        generation: vn.generation,
        isFocal: vn.isFocal,
        isPedigreeCollapsePoint: vn.isPedigreeCollapsePoint,
        hasUnexpandedNeighbors: vn.hasUnexpandedNeighbors,
        isSelected: selectedIds?.has(id) ?? false,
        isHighlighted,
        isDimmed: dimUnhighlighted && !isHighlighted,
      },
    };
  });

  const edges: Edge[] = view.edges.map((e) => {
    const key = edgeKey(e);
    const onPath = highlightedEdgeKeys?.has(key) ?? false;
    return {
      id: key,
      source: e.from,
      target: e.to,
      type: 'default',
      animated: onPath,
      // spouseOf is an undirected pairing → no arrowhead; parentOf points down.
      data: { edgeType: e.type, familyId: e.familyId },
      style: {
        stroke: onPath ? '#dc2626' : e.type === 'spouseOf' ? '#9ca3af' : '#6b7280',
        strokeWidth: onPath ? 2.5 : 1.5,
        strokeDasharray: e.type === 'spouseOf' ? '4 3' : undefined,
        opacity: dimUnhighlighted && !onPath ? 0.2 : 1,
      },
    };
  });

  return { nodes, edges };
}
