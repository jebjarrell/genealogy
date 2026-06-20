import type { GenealogyModel, Event, Place } from '../types/index.js';

// extractEventSequence — the Step-Two seam (TRD §6). It assembles a person's
// PLACE-bearing life events into chronological order, ready for a future
// map/timeline view. Only events with a Place are included; events with no
// usable date sort last but are still emitted (when they have a place).

/** An event that has a Place, with a derived chronological sort key. */
export interface LocatedEvent {
  event: Event;
  place: Place;
  sortKey: number;
}

/**
 * Derive a comparable chronological key from an event's date. A fully-known
 * year yields year*10000 + month*100 + day (missing month/day count as 0, so a
 * year-only date sorts at the start of that year). A missing date or year sorts
 * last via MAX_SAFE_INTEGER.
 */
function sortKeyFor(event: Event): number {
  const date = event.date;
  if (date === undefined || date.year === undefined) {
    return Number.MAX_SAFE_INTEGER;
  }
  return date.year * 10000 + (date.month ?? 0) * 100 + (date.day ?? 0);
}

/**
 * The person's place-bearing events in chronological order. Events are gathered
 * from every event in the model in which the person participates (which covers
 * both individual events referenced by `eventIds` and shared family events such
 * as a marriage). Only events that carry a Place are returned. Sorting is stable
 * with an id tie-break, so the order is fully deterministic (TRD §3).
 */
export function extractEventSequence(
  model: GenealogyModel,
  personId: string,
): LocatedEvent[] {
  const located: LocatedEvent[] = [];
  const seen = new Set<string>();

  const consider = (event: Event | undefined): void => {
    if (event === undefined || seen.has(event.id)) return;
    seen.add(event.id);
    const place = event.place;
    if (place === undefined) return;
    located.push({ event, place, sortKey: sortKeyFor(event) });
  };

  // Individual events explicitly attached to the person.
  const person = model.persons.get(personId);
  if (person !== undefined) {
    for (const eventId of person.eventIds) consider(model.events.get(eventId));
  }

  // Shared events (e.g. marriages) where the person is a participant but which
  // are not listed in eventIds.
  for (const event of model.events.values()) {
    if (event.participants.includes(personId)) consider(event);
  }

  located.sort((a, b) => a.sortKey - b.sortKey || a.event.id.localeCompare(b.event.id));
  return located;
}
