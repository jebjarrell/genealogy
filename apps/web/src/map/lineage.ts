import {
  enumeratePaths,
  extractEventSequence,
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

  const stops: LineageStop[] = [];
  for (const step of path.steps) {
    const person = model.persons.get(step.personId);
    if (!person) continue;
    for (const located of extractEventSequence(model, step.personId)) {
      const stop: LineageStop = {
        personId: step.personId,
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

/** Unique places across stops, keyed by normalized string (for geocoding). */
export function uniquePlaces(stops: LineageStop[]): Place[] {
  const byKey = new Map<string, Place>();
  for (const stop of stops) {
    if (!byKey.has(stop.place.normalized)) byKey.set(stop.place.normalized, stop.place);
  }
  return [...byKey.values()];
}
