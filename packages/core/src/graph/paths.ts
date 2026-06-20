import type { Graph, Path, PathStep } from '../types/graph.js';

// Path enumeration — the centerpiece logic (TRD §6, §7.3).
//
// A genealogical relationship path is Λ-shaped: a monotonic ascent (child → parent)
// to a common/apex ancestor, then a monotonic descent (parent → child). Once a path
// turns downward it never turns back up. This yields exactly the meaningful distinct
// relationship paths between two people — including the multiple reconverging paths of
// pedigree collapse — without generating zig-zag artifacts, and it bounds the search.
//
// Only parent/child edges are traversed (consanguineous paths); spouse edges are not.
// Paths are simple (no person is revisited). Enumeration is hard-capped against the
// combinatorial blow-up of deep, densely intermarried trees (TRD §7.3).

export const DEFAULT_MAX_PATHS = 200;
export const DEFAULT_MAX_DEPTH = 25;

export interface EnumeratePathsOptions {
  maxPaths?: number;
  maxDepth?: number;
}

export interface PathEnumeration {
  paths: Path[];
  /** True when a cap stopped the search before it was exhausted (TRD §7.3). */
  truncated: boolean;
}

type Phase = 'ascending' | 'descending';

function trailToPath(trail: string[]): Path {
  const steps: PathStep[] = trail.map((personId, i) =>
    i < trail.length - 1 ? { personId, edgeToNext: 'parentOf' } : { personId },
  );
  return { steps, length: trail.length - 1 };
}

/**
 * Enumerate every distinct Λ-shaped simple path from `fromId` to `toId`, with
 * truncation metadata. This is the shared engine behind the public
 * `enumeratePaths` and (indirectly) the relationship features.
 */
export function enumerateRelationshipPaths(
  graph: Graph,
  fromId: string,
  toId: string,
  options?: EnumeratePathsOptions,
): PathEnumeration {
  const maxPaths = options?.maxPaths ?? DEFAULT_MAX_PATHS;
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const paths: Path[] = [];
  let truncated = false;

  if (fromId === toId) return { paths, truncated };

  const visited = new Set<string>();
  const trail: string[] = [];

  const visit = (node: string, phase: Phase): void => {
    if (paths.length >= maxPaths) {
      truncated = true;
      return;
    }
    visited.add(node);
    trail.push(node);

    if (node === toId) {
      paths.push(trailToPath(trail));
      trail.pop();
      visited.delete(node);
      return;
    }

    const edgesSoFar = trail.length - 1;
    if (edgesSoFar >= maxDepth) {
      // Would need to extend beyond the depth cap to continue: prune and flag.
      truncated = true;
      trail.pop();
      visited.delete(node);
      return;
    }

    // Ascending: keep going up to parents, OR turn and descend to children.
    if (phase === 'ascending') {
      for (const parent of graph.parentsOf.get(node) ?? []) {
        if (!visited.has(parent)) visit(parent, 'ascending');
      }
    }
    // Descending (or the apex turn): go down to children only.
    for (const child of graph.childrenOf.get(node) ?? []) {
      if (!visited.has(child)) visit(child, 'descending');
    }

    trail.pop();
    visited.delete(node);
  };

  visit(fromId, 'ascending');
  return { paths, truncated };
}

/**
 * Every distinct simple relationship path from `fromId` to `toId` following the
 * graph, guarded against blow-up (TRD §6, §7.3). Returns the (possibly capped)
 * list; use {@link enumerateRelationshipPaths} when the truncation flag is needed.
 */
export function enumeratePaths(
  graph: Graph,
  fromId: string,
  toId: string,
  options?: EnumeratePathsOptions,
): Path[] {
  return enumerateRelationshipPaths(graph, fromId, toId, options).paths;
}
