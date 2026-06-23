import dagre from '@dagrejs/dagre';
import type { Edge } from '@xyflow/react';
import type { PersonFlowNode } from './adapter.js';
import type { PedigreeOrientation } from '../fs/project.js';

// Dagre layout (TRD §10.1, §13): rank by the parentOf edges so ancestors stack
// into clean generational tiers above their descendants. Spouse edges are not
// fed to the ranker (they connect same-generation peers); they are still drawn.
//
// Orientation (handoff §6): vertical (portrait) stacks generations top→bottom
// (rankdir TB); horizontal (landscape) lays them left→right (rankdir LR). The
// toggle re-runs this layout; node content and all interactions are unchanged.

export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 76;

export function layout(
  nodes: PersonFlowNode[],
  edges: Edge[],
  orientation: PedigreeOrientation = 'vertical',
): PersonFlowNode[] {
  const g = new dagre.graphlib.Graph();
  const rankdir = orientation === 'horizontal' ? 'LR' : 'TB';
  g.setGraph({ rankdir, nodesep: 40, ranksep: 90, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    const edgeType = (edge.data as { edgeType?: string } | undefined)?.edgeType;
    if (edgeType === 'parentOf') g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    // dagre gives center coordinates; React Flow positions by top-left corner.
    return {
      ...node,
      position: pos
        ? { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 }
        : node.position,
    };
  });
}
