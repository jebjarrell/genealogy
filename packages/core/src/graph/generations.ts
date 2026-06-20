import type { Graph } from '../types/graph.js';

// computeGenerations: BFS upward from the focal person, returning id → generation
// number (focal = 0, parent = 1, grandparent = 2, …). A person reachable at
// multiple depths (pedigree collapse) is recorded at their MINIMUM depth — BFS
// visits the shallowest occurrence first, so the first-seen depth is the minimum
// (TRD §6). Full multiplicity is exposed by enumeratePaths / detectPedigreeCollapse.

export function computeGenerations(
  graph: Graph,
  focalPersonId: string,
): Map<string, number> {
  const generations = new Map<string, number>([[focalPersonId, 0]]);
  let frontier: string[] = [focalPersonId];
  let depth = 0;

  while (frontier.length > 0) {
    depth += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const parent of graph.parentsOf.get(id) ?? []) {
        if (!generations.has(parent)) {
          generations.set(parent, depth);
          next.push(parent);
        }
      }
    }
    frontier = next;
  }
  return generations;
}
