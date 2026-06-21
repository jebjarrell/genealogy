import type { Event, GenealogyModel } from '../types/index.js';

// War-era classification (TRD §9 extension). Used by the profile bio sketch and
// the Family analytics tab. Detection is deliberately conservative: we only key
// off explicit GEDCOM military events and classify the war by the event's year.
// No inference from lifespan overlap (the owner chose accuracy over breadth).

export interface WarEra {
  id: string;
  name: string;
  /** Inclusive year bounds. */
  from: number;
  to: number;
}

// US conflicts most relevant to lineage research (DAR/SAR and beyond).
export const WAR_ERAS: readonly WarEra[] = [
  { id: 'revolution', name: 'American Revolution', from: 1775, to: 1783 },
  { id: 'war1812', name: 'War of 1812', from: 1812, to: 1815 },
  { id: 'mexican', name: 'Mexican–American War', from: 1846, to: 1848 },
  { id: 'civil', name: 'Civil War', from: 1861, to: 1865 },
  { id: 'spanish', name: 'Spanish–American War', from: 1898, to: 1898 },
  { id: 'wwi', name: 'World War I', from: 1917, to: 1918 },
  { id: 'wwii', name: 'World War II', from: 1941, to: 1945 },
  { id: 'korea', name: 'Korean War', from: 1950, to: 1953 },
  { id: 'vietnam', name: 'Vietnam War', from: 1961, to: 1975 },
];

/** The war whose window contains `year`, or null (unknown year / peacetime). */
export function classifyWar(year: number | undefined): WarEra | null {
  if (year === undefined) return null;
  return WAR_ERAS.find((w) => year >= w.from && year <= w.to) ?? null;
}

export interface MilitaryService {
  /** True when the person has any explicit military event. */
  served: boolean;
  /** Wars identified from those events' dates (deduped, in era order). */
  wars: WarEra[];
  /** The underlying military events (raw data preserved). */
  events: Event[];
}

/** A person's explicit military events and the wars they fall in. */
export function militaryServiceOf(
  model: GenealogyModel,
  personId: string,
): MilitaryService {
  const events: Event[] = [];
  const seen = new Set<string>();
  const add = (event: Event | undefined): void => {
    if (event === undefined || event.type !== 'military' || seen.has(event.id)) return;
    seen.add(event.id);
    events.push(event);
  };

  const person = model.persons.get(personId);
  if (person) for (const id of person.eventIds) add(model.events.get(id));
  // Military events occasionally recorded as shared events.
  for (const event of model.events.values()) {
    if (event.participants.includes(personId)) add(event);
  }

  const wars: WarEra[] = [];
  const warSeen = new Set<string>();
  for (const era of WAR_ERAS) {
    if (warSeen.has(era.id)) continue;
    if (events.some((e) => classifyWar(e.date?.year)?.id === era.id)) {
      warSeen.add(era.id);
      wars.push(era);
    }
  }

  return { served: events.length > 0, wars, events };
}
