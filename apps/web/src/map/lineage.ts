import {
  enumeratePaths,
  extractEventSequence,
  getAncestors,
  type Event,
  type GenealogyModel,
  type Graph,
  type Path,
  type Person,
  type Place,
} from '@genealogy/core';

// Pure helpers for the migration map: turn a (focal → ancestor) selection into an
// ordered, geocodable timeline of located events along that ancestral line.
// Reuses core's enumeratePaths (the lineage chain) and extractEventSequence
// (located events per person). No DOM, no network — easy to unit-test.

export interface LineageStop {
  personId: string;
  person: Person;
  event: Event;
  place: Place;
  /** Best-known year for the event (undefined if the date has none). */
  year?: number;
  /** Chronological sort key from the event date. */
  sortKey: number;
}

/** Distinct ancestral paths from `fromId` up to `toId` (may be >1 under collapse). */
export function lineagePaths(graph: Graph, fromId: string, toId: string): Path[] {
  return enumeratePaths(graph, fromId, toId);
}

/** Merge each person's located events into one chronological list of stops. */
function stopsForPersons(model: GenealogyModel, personIds: Iterable<string>): LineageStop[] {
  const stops: LineageStop[] = [];
  const seenPeople = new Set<string>();
  // A shared event (e.g. a marriage) is reachable from both spouses; emit it once.
  const seenEvents = new Set<string>();
  for (const id of personIds) {
    if (seenPeople.has(id)) continue;
    seenPeople.add(id);
    const person = model.persons.get(id);
    if (!person) continue;
    for (const located of extractEventSequence(model, id)) {
      if (seenEvents.has(located.event.id)) continue;
      seenEvents.add(located.event.id);
      const stop: LineageStop = {
        personId: id,
        person,
        event: located.event,
        place: located.place,
        sortKey: located.sortKey,
      };
      const year = located.event.date?.year;
      if (year !== undefined) stop.year = year;
      stops.push(stop);
    }
  }
  stops.sort((a, b) => a.sortKey - b.sortKey || a.event.id.localeCompare(b.event.id));
  return stops;
}

/**
 * The located events along the chosen lineage path, ordered chronologically.
 * `pathIndex` selects among multiple paths (pedigree collapse); defaults to the
 * first. The people are those on the path; their located events are merged and
 * sorted by date so the result reads as the line's migration over time.
 */
export function lineageStops(
  model: GenealogyModel,
  graph: Graph,
  fromId: string,
  toId: string,
  pathIndex = 0,
): LineageStop[] {
  const paths = enumeratePaths(graph, fromId, toId);
  const path = paths[pathIndex] ?? paths[0];
  if (!path) return [];
  return stopsForPersons(
    model,
    path.steps.map((s) => s.personId),
  );
}

/**
 * Located events for the focal person and ALL of their ancestors, merged and
 * ordered chronologically. This is the default migration view: the whole
 * pedigree's movement over time, not a single line.
 */
export function allAncestorStops(
  model: GenealogyModel,
  graph: Graph,
  focalId: string,
): LineageStop[] {
  return stopsForPersons(model, [focalId, ...getAncestors(graph, focalId)]);
}

/** Unique places across stops, keyed by normalized string (for geocoding). */
export function uniquePlaces(stops: LineageStop[]): Place[] {
  const byKey = new Map<string, Place>();
  for (const stop of stops) {
    if (!byKey.has(stop.place.normalized)) byKey.set(stop.place.normalized, stop.place);
  }
  return [...byKey.values()];
}
