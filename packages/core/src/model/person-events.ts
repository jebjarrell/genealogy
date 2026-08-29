import type { Event } from '../types/events.js';
import type { GenealogyModel } from '../types/model.js';
import type { Person } from '../types/persons.js';

// Reading a person's vital events off the model. Was duplicated privately in
// analytics/family-stats.ts and profile/sketch.ts; edit/link-validation.ts needed
// a third copy, so it lives here instead.

/** The first event of `type` this person participates in, if any. */
export function firstEvent(
  person: Person,
  model: GenealogyModel,
  type: Event['type'],
): Event | undefined {
  for (const id of person.eventIds) {
    const e = model.events.get(id);
    if (e?.type === type) return e;
  }
  return undefined;
}

/**
 * The year of a person's first event of `type`, or undefined when the person,
 * the event, or a resolvable year is missing. Callers treat undefined as
 * "unknown" and must not infer anything from it - GEDCOM dates are frequently
 * absent or unparseable, and a missing date is never evidence of a problem.
 */
export function eventYear(
  model: GenealogyModel,
  personId: string,
  type: Event['type'],
): number | undefined {
  const person = model.persons.get(personId);
  if (!person) return undefined;
  return firstEvent(person, model, type)?.date?.year;
}
