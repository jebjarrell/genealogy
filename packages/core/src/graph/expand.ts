import type { Graph, GraphEdge, GraphView, GraphViewNode } from '../types/graph.js';
import type { GenealogyModel } from '../types/index.js';
import { detectPedigreeCollapse } from './collapse.js';

// expandPerson — the progressive-disclosure step behind the "expand" affordance
// (TRD §6/§13). Given the current view and a node the user clicked, compute the
// neighbours to reveal in a chosen direction and the edges that connect them.
// Only the ADDITIONS are returned; the renderer merges them into the view.

/**
 * Reveal new neighbours of `personId` in `direction`. Returns the GraphViewNodes
 * and GraphEdges to add (none already present in the view). Generations are
 * relative to the focal person, anchored on the clicked node's generation.
 */
export function expandPerson(
  graph: Graph,
  model: GenealogyModel,
  currentView: GraphView,
  personId: string,
  direction: 'ancestors' | 'descendants' | 'all',
): { addedNodes: GraphViewNode[]; addedEdges: GraphEdge[] } {
  const included = new Set(currentView.nodes.map((n) => n.person.id));

  const anchor = currentView.nodes.find((n) => n.person.id === personId);
  const g = anchor?.generation ?? 0;

  // Collect candidate new neighbours with their target generation. A neighbour
  // already in the view is skipped; duplicates across directions keep the first
  // generation assigned (deterministic by the order parents/children/spouses are
  // considered).
  const newGeneration = new Map<string, number>();
  const consider = (ids: string[], gen: number): void => {
    for (const id of ids) {
      if (included.has(id) || newGeneration.has(id)) continue;
      if (!model.persons.has(id)) continue;
      newGeneration.set(id, gen);
    }
  };

  if (direction === 'ancestors' || direction === 'all') {
    consider(graph.parentsOf.get(personId) ?? [], g + 1);
  }
  if (direction === 'descendants' || direction === 'all') {
    consider(graph.childrenOf.get(personId) ?? [], g - 1);
  }
  if (direction === 'all') {
    consider(graph.spousesOf.get(personId) ?? [], g);
  }

  // The set of ids the view will contain once these additions land.
  const afterIds = new Set(included);
  for (const id of newGeneration.keys()) afterIds.add(id);

  const collapseIds = new Set(
    detectPedigreeCollapse(graph, currentView.focalPersonId).map((p) => p.ancestorId),
  );

  const hasUnexpandedNeighbors = (id: string): boolean => {
    const neighbors = [
      ...(graph.parentsOf.get(id) ?? []),
      ...(graph.childrenOf.get(id) ?? []),
      ...(graph.spousesOf.get(id) ?? []),
    ];
    return neighbors.some((n) => !afterIds.has(n));
  };

  const addedIds = [...newGeneration.keys()].sort((a, b) => a.localeCompare(b));
  const addedNodes: GraphViewNode[] = [];
  for (const id of addedIds) {
    const person = model.persons.get(id);
    if (person === undefined) continue;
    addedNodes.push({
      person,
      generation: newGeneration.get(id) ?? 0,
      isFocal: false,
      isPedigreeCollapsePoint: collapseIds.has(id),
      hasUnexpandedNeighbors: hasUnexpandedNeighbors(id),
    });
  }

  // Edges to add: those incident to a newly-added node, with BOTH endpoints in
  // the post-merge set, that are not already drawn in the current view.
  const existingEdgeKeys = new Set(
    currentView.edges.map((e) => `${e.type} ${e.from} ${e.to}`),
  );
  const addedEdges: GraphEdge[] = [];
  for (const edge of graph.edges) {
    if (!afterIds.has(edge.from) || !afterIds.has(edge.to)) continue;
    const touchesNew = newGeneration.has(edge.from) || newGeneration.has(edge.to);
    if (!touchesNew) continue;
    const key = `${edge.type} ${edge.from} ${edge.to}`;
    if (existingEdgeKeys.has(key)) continue;
    addedEdges.push(edge);
  }

  return { addedNodes, addedEdges };
}
