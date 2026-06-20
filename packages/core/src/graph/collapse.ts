import type { Graph, Path, PathStep } from '../types/graph.js';
import { DEFAULT_MAX_DEPTH, DEFAULT_MAX_PATHS } from './paths.js';

// Pedigree-collapse detection (TRD §6, §10.5) — the reason this tool exists.
// An ancestor reachable from the focal person by 2+ distinct ancestral paths is a
// collapse point: the same person is related to you in more than one way.

export interface CollapsePoint {
  ancestorId: string;
  /** The distinct ancestral paths from focal to this ancestor. */
  paths: Path[];
  pathCount: number;
  /** True when the per-ancestor cap was hit and more paths exist (TRD §7.3). */
  truncated?: boolean;
}

export interface DetectCollapseOptions {
  maxPathsPerAncestor?: number;
  maxDepth?: number;
}

function trailToPath(trail: string[]): Path {
  const steps: PathStep[] = trail.map((personId, i) =>
    i < trail.length - 1 ? { personId, edgeToNext: 'parentOf' } : { personId },
  );
  return { steps, length: trail.length - 1 };
}

/**
 * Collect every simple ancestral (upward-only) path from the focal person,
 * grouped by the ancestor each path reaches. Because every prefix of an upward
 * walk is itself a path to the node at its tip, one DFS yields, for every
 * ancestor, all the distinct routes that reach it.
 */
function collectUpwardPaths(
  graph: Graph,
  focalId: string,
  maxPathsPerAncestor: number,
  maxDepth: number,
): { pathsByAncestor: Map<string, Path[]>; truncated: Set<string> } {
  const pathsByAncestor = new Map<string, Path[]>();
  const truncated = new Set<string>();
  const visited = new Set<string>();
  const trail: string[] = [];

  const visit = (node: string): void => {
    visited.add(node);
    trail.push(node);

    if (node !== focalId) {
      const list = pathsByAncestor.get(node);
      if (list === undefined) {
        pathsByAncestor.set(node, [trailToPath(trail)]);
      } else if (list.length < maxPathsPerAncestor) {
        list.push(trailToPath(trail));
      } else {
        truncated.add(node);
      }
    }

    if (trail.length - 1 < maxDepth) {
      for (const parent of graph.parentsOf.get(node) ?? []) {
        if (!visited.has(parent)) visit(parent);
      }
    }

    trail.pop();
    visited.delete(node);
  };

  visit(focalId);
  return { pathsByAncestor, truncated };
}

/**
 * Ancestors of `focalPersonId` reachable by 2+ distinct paths — the pedigree
 * collapse. Deterministically ordered by nearest collapse first (shortest path),
 * then by ancestor id.
 */
export function detectPedigreeCollapse(
  graph: Graph,
  focalPersonId: string,
  options?: DetectCollapseOptions,
): CollapsePoint[] {
  const maxPathsPerAncestor = options?.maxPathsPerAncestor ?? DEFAULT_MAX_PATHS;
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;

  const { pathsByAncestor, truncated } = collectUpwardPaths(
    graph,
    focalPersonId,
    maxPathsPerAncestor,
    maxDepth,
  );

  const points: CollapsePoint[] = [];
  for (const [ancestorId, paths] of pathsByAncestor) {
    if (paths.length < 2) continue;
    const point: CollapsePoint = {
      ancestorId,
      paths,
      pathCount: paths.length,
    };
    if (truncated.has(ancestorId)) point.truncated = true;
    points.push(point);
  }

  points.sort((a, b) => {
    const aMin = Math.min(...a.paths.map((p) => p.length));
    const bMin = Math.min(...b.paths.map((p) => p.length));
    return aMin - bMin || a.ancestorId.localeCompare(b.ancestorId);
  });
  return points;
}
