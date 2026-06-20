import type {
  GenealogyModel,
  Graph,
  GraphView,
  GraphViewNode,
  Path,
} from '@genealogy/core';

// Pure view-model helpers shared by the store. Kept separate (and free of React
// and React Flow) so they are easy to unit-test.

/**
 * Focal-relative generation of every reachable person: focal = 0, ancestors
 * positive, descendants negative. Collateral relatives are absent (undefined).
 */
export function focalGenerations(graph: Graph, focalId: string): Map<string, number> {
  const gen = new Map<string, number>([[focalId, 0]]);

  let frontier: string[] = [focalId];
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const parent of graph.parentsOf.get(id) ?? []) {
        if (!gen.has(parent)) {
          gen.set(parent, depth);
          next.push(parent);
        }
      }
    }
    frontier = next;
  }

  const seenDown = new Set<string>([focalId]);
  frontier = [focalId];
  depth = 0;
  while (frontier.length > 0) {
    depth -= 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const child of graph.childrenOf.get(id) ?? []) {
        if (!seenDown.has(child)) {
          seenDown.add(child);
          if (!gen.has(child)) gen.set(child, depth);
          next.push(child);
        }
      }
    }
    frontier = next;
  }
  return gen;
}

/** All immediate neighbours of a person (parents ∪ children ∪ spouses), unique. */
export function neighborsOf(graph: Graph, id: string): string[] {
  const set = new Set<string>([
    ...(graph.parentsOf.get(id) ?? []),
    ...(graph.childrenOf.get(id) ?? []),
    ...(graph.spousesOf.get(id) ?? []),
  ]);
  return [...set];
}

/**
 * Assemble a GraphView from a set of person ids, recomputing node flags and the
 * induced edge set. This is the single source of truth for what is on screen, so
 * expansion and path-highlighting stay consistent with the initial ego network.
 */
export function buildView(
  graph: Graph,
  model: GenealogyModel,
  focalId: string,
  collapseSet: ReadonlySet<string>,
  genMap: ReadonlyMap<string, number>,
  nodeIds: ReadonlySet<string>,
): GraphView {
  const nodes: GraphViewNode[] = [];
  for (const id of nodeIds) {
    const person = model.persons.get(id);
    if (!person) continue;
    const node: GraphViewNode = {
      person,
      isFocal: id === focalId,
      isPedigreeCollapsePoint: collapseSet.has(id),
      hasUnexpandedNeighbors: neighborsOf(graph, id).some((n) => !nodeIds.has(n)),
    };
    const generation = genMap.get(id);
    if (generation !== undefined) node.generation = generation;
    nodes.push(node);
  }

  // Oldest generation first, then by id — deterministic and dagre-friendly.
  nodes.sort(
    (a, b) =>
      (b.generation ?? 0) - (a.generation ?? 0) ||
      a.person.id.localeCompare(b.person.id),
  );

  const edges = graph.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  return { nodes, edges, focalPersonId: focalId };
}

/** Node ids and (direction-agnostic) edge keys that lie on the given paths. */
export function pathsToHighlight(paths: Path[]): {
  nodeIds: Set<string>;
  edgeKeys: Set<string>;
} {
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  for (const path of paths) {
    for (let i = 0; i < path.steps.length; i++) {
      const id = path.steps[i]!.personId;
      nodeIds.add(id);
      const nextStep = path.steps[i + 1];
      if (nextStep) {
        // A parent/child hop; the stored edge always points parent → child, so
        // add both orientations and let the adapter match whichever exists.
        edgeKeys.add(`parentOf:${id}->${nextStep.personId}`);
        edgeKeys.add(`parentOf:${nextStep.personId}->${id}`);
      }
    }
  }
  return { nodeIds, edgeKeys };
}
