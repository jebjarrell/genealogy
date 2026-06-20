import type { Graph, GraphEdge, GraphView, GraphViewNode } from '../types/graph.js';
import type { GenealogyModel } from '../types/index.js';
import { detectPedigreeCollapse } from './collapse.js';

// getEgoNetwork — build the bounded, ego-centric subgraph the renderer draws
// (TRD §6/§13). Starting from a focal person, walk a limited number of ancestor
// and descendant generations, optionally pull in spouses, and cap the result to
// a node budget so even a huge tree yields a drawable view.

export interface EgoNetworkOptions {
  /** Generations of ancestors to include (default 4). */
  ancestorGenerations?: number;
  /** Generations of descendants to include (default 0). */
  descendantGenerations?: number;
  /** Pull in spouses of included people (default true). */
  includeSpouses?: boolean;
  /** Hard cap on the number of nodes emitted (default 300). */
  nodeBudget?: number;
}

const DEFAULTS: Required<EgoNetworkOptions> = {
  ancestorGenerations: 4,
  descendantGenerations: 0,
  includeSpouses: true,
  nodeBudget: 300,
};

/**
 * Breadth-first walk over `adjacency` from `start`, recording each newly-seen id
 * at `sign * depth`. Already-recorded ids (in `generation`) are not overwritten,
 * so a person reachable at multiple depths keeps their shallowest generation.
 */
function walkGenerations(
  adjacency: Map<string, string[]>,
  start: string,
  maxDepth: number,
  sign: 1 | -1,
  generation: Map<string, number>,
): void {
  if (maxDepth <= 0) return;
  let frontier: string[] = [start];
  let depth = 0;
  while (frontier.length > 0 && depth < maxDepth) {
    depth += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!generation.has(neighbor)) {
          generation.set(neighbor, sign * depth);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
}

export function getEgoNetwork(
  graph: Graph,
  model: GenealogyModel,
  focalPersonId: string,
  options?: EgoNetworkOptions,
): GraphView {
  const ancestorGenerations =
    options?.ancestorGenerations ?? DEFAULTS.ancestorGenerations;
  const descendantGenerations =
    options?.descendantGenerations ?? DEFAULTS.descendantGenerations;
  const includeSpouses = options?.includeSpouses ?? DEFAULTS.includeSpouses;
  const nodeBudget = options?.nodeBudget ?? DEFAULTS.nodeBudget;

  // 1. Focal-relative generation map for blood relatives.
  const bloodGeneration = new Map<string, number>([[focalPersonId, 0]]);
  walkGenerations(
    graph.parentsOf,
    focalPersonId,
    ancestorGenerations,
    1,
    bloodGeneration,
  );
  walkGenerations(
    graph.childrenOf,
    focalPersonId,
    descendantGenerations,
    -1,
    bloodGeneration,
  );

  // 2. Spouses inherit the generation of the partner through whom they enter.
  //    We do not recurse into a spouse's blood line.
  const generation = new Map<string, number>(bloodGeneration);
  const isSpouseOnly = new Set<string>();
  if (includeSpouses) {
    for (const [id, gen] of bloodGeneration) {
      for (const spouse of graph.spousesOf.get(id) ?? []) {
        if (!generation.has(spouse)) {
          generation.set(spouse, gen);
          isSpouseOnly.add(spouse);
        }
      }
    }
  }

  // 3. Enforce the node budget. Priority: focal first, then blood relatives by
  //    increasing |generation| (tie-break id), then spouses (by id). Skip ids
  //    with no person record.
  const candidates: string[] = [];
  for (const id of generation.keys()) {
    if (model.persons.has(id)) candidates.push(id);
  }
  candidates.sort((a, b) => {
    if (a === focalPersonId) return b === focalPersonId ? 0 : -1;
    if (b === focalPersonId) return 1;
    const aSpouse = isSpouseOnly.has(a);
    const bSpouse = isSpouseOnly.has(b);
    if (aSpouse !== bSpouse) return aSpouse ? 1 : -1; // blood before spouse
    if (!aSpouse) {
      const aAbs = Math.abs(generation.get(a) ?? 0);
      const bAbs = Math.abs(generation.get(b) ?? 0);
      if (aAbs !== bAbs) return aAbs - bAbs;
    }
    return a.localeCompare(b);
  });

  const includedOrder =
    candidates.length > nodeBudget ? candidates.slice(0, nodeBudget) : candidates;
  const included = new Set(includedOrder);

  // 4. Build the nodes.
  const collapseIds = new Set(
    detectPedigreeCollapse(graph, focalPersonId).map((p) => p.ancestorId),
  );

  const hasUnexpandedNeighbors = (id: string): boolean => {
    const neighbors = [
      ...(graph.parentsOf.get(id) ?? []),
      ...(graph.childrenOf.get(id) ?? []),
      ...(graph.spousesOf.get(id) ?? []),
    ];
    return neighbors.some((n) => !included.has(n));
  };

  const nodes: GraphViewNode[] = [];
  for (const id of included) {
    const person = model.persons.get(id);
    if (person === undefined) continue;
    nodes.push({
      person,
      generation: generation.get(id) ?? 0,
      isFocal: id === focalPersonId,
      isPedigreeCollapsePoint: collapseIds.has(id),
      hasUnexpandedNeighbors: hasUnexpandedNeighbors(id),
    });
  }

  // Deterministic node order: focal first, then by generation descending
  // (oldest ancestors first), then id.
  nodes.sort((a, b) => {
    if (a.isFocal) return b.isFocal ? 0 : -1;
    if (b.isFocal) return 1;
    const ag = a.generation ?? 0;
    const bg = b.generation ?? 0;
    if (ag !== bg) return bg - ag;
    return a.person.id.localeCompare(b.person.id);
  });

  // 5. Edges among included nodes only, preserving graph.edges order.
  const edges: GraphEdge[] = graph.edges.filter(
    (e) => included.has(e.from) && included.has(e.to),
  );

  return { nodes, edges, focalPersonId };
}
