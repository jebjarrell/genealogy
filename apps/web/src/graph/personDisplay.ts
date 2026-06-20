import type { Event, GenealogyModel, Person } from '@genealogy/core';

// Display helpers for a person card. Pure; no rendering-library types.

export function primaryName(person: Person): string {
  const name = person.names[0];
  if (!name) return '(unnamed)';
  return name.full || name.raw || '(unnamed)';
}

function yearOf(event: Event | undefined): string {
  const year = event?.date?.year;
  return year === undefined ? '' : String(year);
}

function findEvent(
  person: Person,
  model: GenealogyModel,
  type: Event['type'],
): Event | undefined {
  for (const id of person.eventIds) {
    const event = model.events.get(id);
    if (event?.type === type) return event;
  }
  return undefined;
}

/** "1850–1912", "b. 1850", "d. 1912", or "" when neither year is known. */
export function lifeSpan(person: Person, model: GenealogyModel): string {
  const birth = yearOf(findEvent(person, model, 'birth'));
  const death = yearOf(findEvent(person, model, 'death'));
  if (birth && death) return `${birth}–${death}`;
  if (birth) return `b. ${birth}`;
  if (death) return `d. ${death}`;
  return '';
}

/** Every event a person participates in (individual events + family marriages). */
export function allEventsOf(person: Person, model: GenealogyModel): Event[] {
  const seen = new Set<string>();
  const events: Event[] = [];
  const add = (id: string) => {
    if (seen.has(id)) return;
    const event = model.events.get(id);
    if (event) {
      seen.add(id);
      events.push(event);
    }
  };
  for (const id of person.eventIds) add(id);
  for (const famId of person.familyIdsAsSpouse) {
    const family = model.families.get(famId);
    for (const id of family?.marriageEventIds ?? []) add(id);
  }
  return events;
}

/** The most-specific part of the person's birth (or earliest located) place. */
export function primaryPlace(person: Person, model: GenealogyModel): string {
  const birth = findEvent(person, model, 'birth');
  const place = birth?.place;
  if (place) return place.parts?.[0] ?? place.raw;
  for (const id of person.eventIds) {
    const event = model.events.get(id);
    if (event?.place) return event.place.parts?.[0] ?? event.place.raw;
  }
  return '';
}
