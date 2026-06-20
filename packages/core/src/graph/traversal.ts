import type { Graph } from '../types/graph.js';

// Ancestor / descendant traversal (TRD §6). Breadth-first so results come back
// in increasing-distance order; deduplicated so a person reachable by multiple
// paths (pedigree collapse) appears once. `generations` optionally caps the walk.

function walk(
  adjacency: Map<string, string[]>,
  startId: string,
  generations: number | undefined,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>([startId]);
  let frontier: string[] = [startId];
  let depth = 0;

  while (frontier.length > 0) {
    if (generations !== undefined && depth >= generations) break;
    depth += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          result.push(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return result;
}

/** Ancestors of `personId` (parents, grandparents, …), nearest first. */
export function getAncestors(
  graph: Graph,
  personId: string,
  generations?: number,
): string[] {
  return walk(graph.parentsOf, personId, generations);
}

/** Descendants of `personId` (children, grandchildren, …), nearest first. */
export function getDescendants(
  graph: Graph,
  personId: string,
  generations?: number,
): string[] {
  return walk(graph.childrenOf, personId, generations);
}
