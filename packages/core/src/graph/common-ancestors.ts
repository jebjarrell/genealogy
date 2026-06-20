import type { Graph, Path } from '../types/graph.js';
import { computeGenerations } from './generations.js';
import { getAncestors } from './traversal.js';
import { enumeratePaths } from './paths.js';

// Nearest common ancestors of two people, with the paths from each (TRD §6, §9).
// Used by relationship description for collateral (cousin / aunt-uncle) cases.

export interface CommonAncestor {
  ancestorId: string;
  pathsFromA: Path[];
  pathsFromB: Path[];
  /** Shortest distance A → ancestor. */
  generationsFromA: number;
  /** Shortest distance B → ancestor. */
  generationsFromB: number;
}

const shortest = (paths: Path[]): number =>
  paths.reduce((min, p) => Math.min(min, p.length), Infinity);

export function findCommonAncestors(
  graph: Graph,
  personIdA: string,
  personIdB: string,
): CommonAncestor[] {
  const genA = computeGenerations(graph, personIdA); // includes A at depth 0
  const genB = computeGenerations(graph, personIdB);

  // Proper common ancestors: ancestors (depth ≥ 1) of BOTH, excluding A and B.
  const common = new Set<string>();
  for (const [id, depth] of genA) {
    if (depth >= 1 && id !== personIdB && genB.has(id) && (genB.get(id) ?? 0) >= 1) {
      common.add(id);
    }
  }

  // Keep only the *nearest* common ancestors (MRCAs): a common ancestor X is
  // nearest unless it is itself an ancestor of another common ancestor Y (which
  // would make Y the closer meeting point on that line).
  const nearest = [...common].filter((x) => {
    for (const y of common) {
      if (y !== x && getAncestors(graph, y).includes(x)) return false;
    }
    return true;
  });

  const result: CommonAncestor[] = nearest.map((ancestorId) => {
    const pathsFromA = enumeratePaths(graph, personIdA, ancestorId);
    const pathsFromB = enumeratePaths(graph, personIdB, ancestorId);
    return {
      ancestorId,
      pathsFromA,
      pathsFromB,
      generationsFromA: shortest(pathsFromA),
      generationsFromB: shortest(pathsFromB),
    };
  });

  // Nearest meeting points first (smallest combined distance), then by id.
  result.sort(
    (a, b) =>
      a.generationsFromA +
        a.generationsFromB -
        (b.generationsFromA + b.generationsFromB) ||
      a.ancestorId.localeCompare(b.ancestorId),
  );
  return result;
}
