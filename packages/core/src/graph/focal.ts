import type { Graph } from '../types/graph.js';
import type { GenealogyModel, Person } from '../types/index.js';

// pickDefaultFocalPerson — choose the person the ego-network view should center
// on when the caller does not specify one (TRD §6/§13). The heuristic prefers a
// declared root, then the "most plausible youngest leaf" (a childless person
// with the latest known year), then the most-connected individual.

/**
 * The maximum known year across a person's events (by eventIds), or undefined if
 * none of the person's dated events carry a year.
 */
function latestYear(model: GenealogyModel, person: Person): number | undefined {
  let best: number | undefined;
  for (const eventId of person.eventIds) {
    const year = model.events.get(eventId)?.date?.year;
    if (year === undefined) continue;
    if (best === undefined || year > best) best = year;
  }
  return best;
}

/** A leaf is a person who is nobody's parent (no children in the graph). */
function isLeaf(graph: Graph, id: string): boolean {
  const children = graph.childrenOf.get(id);
  return children === undefined || children.length === 0;
}

function degree(graph: Graph, id: string): number {
  return (
    (graph.parentsOf.get(id)?.length ?? 0) +
    (graph.childrenOf.get(id)?.length ?? 0) +
    (graph.spousesOf.get(id)?.length ?? 0)
  );
}

export function pickDefaultFocalPerson(graph: Graph, model: GenealogyModel): string {
  // 1. A declared root person, if it exists in the model.
  const rootId = model.header?.rootPersonId;
  if (rootId !== undefined && model.persons.has(rootId)) return rootId;

  // No persons at all → empty result.
  if (model.persons.size === 0) return '';

  // 2. The most plausible youngest leaf: among childless persons, the one with
  //    the latest known year. A leaf with a known year outranks one with none;
  //    tie-break higher year first, then smallest id.
  let bestLeaf: string | undefined;
  let bestLeafYear: number | undefined;
  for (const person of model.persons.values()) {
    if (!isLeaf(graph, person.id)) continue;
    const year = latestYear(model, person);

    if (bestLeaf === undefined) {
      bestLeaf = person.id;
      bestLeafYear = year;
      continue;
    }

    if (year !== undefined && bestLeafYear === undefined) {
      // A dated leaf always beats an undated one.
      bestLeaf = person.id;
      bestLeafYear = year;
    } else if (year !== undefined && bestLeafYear !== undefined) {
      if (year > bestLeafYear || (year === bestLeafYear && person.id < bestLeaf)) {
        bestLeaf = person.id;
        bestLeafYear = year;
      }
    } else if (year === undefined && bestLeafYear === undefined) {
      // Both undated → smallest id wins.
      if (person.id < bestLeaf) bestLeaf = person.id;
    }
    // year === undefined && bestLeafYear !== undefined → keep the dated leaf.
  }
  if (bestLeaf !== undefined) return bestLeaf;

  // 3. No leaves → the most-connected individual; tie-break smallest id.
  let bestId: string | undefined;
  let bestDegree = -1;
  for (const person of model.persons.values()) {
    const d = degree(graph, person.id);
    if (
      d > bestDegree ||
      (d === bestDegree && bestId !== undefined && person.id < bestId)
    ) {
      bestId = person.id;
      bestDegree = d;
    }
  }
  return bestId ?? '';
}
