import type { Event, GenealogyModel, Graph, Person } from '@genealogy/core';

// Build deep-links into external genealogy sites, pre-filled from a person's
// known facts. No API keys, no network from here — each function just composes a
// search URL the user opens in a new tab. Pure and unit-tested.

export interface NameParts {
  given: string;
  surname: string;
  full: string;
}

export interface ResearchFacts {
  given: string;
  surname: string;
  fullName: string;
  sex: Person['sex'];
  birthYear?: number;
  birthPlaceParts?: string[];
  birthPlaceRaw?: string;
  deathYear?: number;
  deathPlaceParts?: string[];
  deathPlaceRaw?: string;
  father?: NameParts;
  mother?: NameParts;
  spouses: NameParts[];
  children: NameParts[];
}

function nameParts(person: Person): NameParts {
  const n = person.names[0];
  return {
    given: n?.given?.trim() ?? '',
    surname: n?.surname?.trim() ?? '',
    full: (n?.full || n?.raw || '').trim(),
  };
}

function firstEvent(
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

/** Gather the facts the external search forms accept, from model + graph. */
export function researchFacts(
  model: GenealogyModel,
  graph: Graph,
  personId: string,
): ResearchFacts | null {
  const person = model.persons.get(personId);
  if (!person) return null;

  const self = nameParts(person);
  const birth = firstEvent(person, model, 'birth');
  const death = firstEvent(person, model, 'death');

  // Parents split into father/mother by recorded sex.
  let father: NameParts | undefined;
  let mother: NameParts | undefined;
  for (const pid of graph.parentsOf.get(personId) ?? []) {
    const parent = model.persons.get(pid);
    if (!parent) continue;
    const parts = nameParts(parent);
    if (parent.sex === 'female' && !mother) mother = parts;
    else if (parent.sex === 'male' && !father) father = parts;
    else if (!father) father = parts;
    else if (!mother) mother = parts;
  }

  const namesFor = (ids: string[]): NameParts[] =>
    ids
      .map((id) => model.persons.get(id))
      .filter((p): p is Person => !!p)
      .map(nameParts);

  const facts: ResearchFacts = {
    given: self.given,
    surname: self.surname,
    fullName: self.full,
    sex: person.sex,
    spouses: namesFor(graph.spousesOf.get(personId) ?? []),
    children: namesFor(graph.childrenOf.get(personId) ?? []),
  };
  if (birth?.date?.year !== undefined) facts.birthYear = birth.date.year;
  if (birth?.place) {
    if (birth.place.parts) facts.birthPlaceParts = birth.place.parts;
    facts.birthPlaceRaw = birth.place.raw;
  }
  if (death?.date?.year !== undefined) facts.deathYear = death.date.year;
  if (death?.place) {
    if (death.place.parts) facts.deathPlaceParts = death.place.parts;
    facts.deathPlaceRaw = death.place.raw;
  }
  if (father) facts.father = father;
  if (mother) facts.mother = mother;
  return facts;
}

// --- Ancestry.com -------------------------------------------------------
// Ancestry's advanced-search URL uses its own packing: spaces → '+', a '_'
// between given and surname, and '-' between place levels (most-specific first).

function plus(value: string): string {
  return encodeURIComponent(value.trim()).replace(/%20/g, '+');
}

function ancestryName(name: NameParts): string {
  const g = plus(name.given);
  const s = plus(name.surname);
  if (g && s) return `${g}_${s}`;
  return g || s || plus(name.full);
}

function ancestryPlace(parts?: string[]): string {
  if (!parts || parts.length === 0) return '';
  return parts.map(plus).join('-');
}

function ancestryEvent(year: number | undefined, parts: string[] | undefined): string {
  const place = ancestryPlace(parts);
  if (year !== undefined && place) return `${year}_${place}`;
  if (year !== undefined) return String(year);
  return place;
}

const MAX_CHILDREN = 8;

export function ancestrySearchUrl(f: ResearchFacts): string {
  const params: string[] = [];
  const name = ancestryName({ given: f.given, surname: f.surname, full: f.fullName });
  if (name) params.push(`name=${name}`);
  const birth = ancestryEvent(f.birthYear, f.birthPlaceParts);
  if (birth) params.push(`birth=${birth}`);
  const death = ancestryEvent(f.deathYear, f.deathPlaceParts);
  if (death) params.push(`death=${death}`);
  if (f.father) params.push(`father=${ancestryName(f.father)}`);
  if (f.mother) params.push(`mother=${ancestryName(f.mother)}`);
  if (f.spouses[0]) params.push(`spouse=${ancestryName(f.spouses[0])}`);
  f.children.slice(0, MAX_CHILDREN).forEach((child, i) => {
    const key = i === 0 ? 'child' : `child${i + 1}`;
    params.push(`${key}=${ancestryName(child)}`);
  });
  if (f.sex === 'male') params.push('gender=m');
  else if (f.sex === 'female') params.push('gender=f');
  params.push('searchMode=advanced');
  return `https://www.ancestry.com/search/?${params.join('&')}`;
}

// --- FamilySearch -------------------------------------------------------
// FamilySearch record search takes standard query params; we widen the date to
// ±2 years to tolerate the usual record/transcription drift.

const DATE_SLOP = 2;

export function familySearchRecordUrl(f: ResearchFacts): string {
  const p = new URLSearchParams();
  if (f.given) p.set('q.givenName', f.given);
  if (f.surname) p.set('q.surname', f.surname);
  if (f.birthPlaceRaw) p.set('q.birthLikePlace', f.birthPlaceRaw);
  if (f.birthYear !== undefined) {
    p.set('q.birthLikeDate.from', String(f.birthYear - DATE_SLOP));
    p.set('q.birthLikeDate.to', String(f.birthYear + DATE_SLOP));
  }
  if (f.deathPlaceRaw) p.set('q.deathLikePlace', f.deathPlaceRaw);
  if (f.deathYear !== undefined) {
    p.set('q.deathLikeDate.from', String(f.deathYear - DATE_SLOP));
    p.set('q.deathLikeDate.to', String(f.deathYear + DATE_SLOP));
  }
  return `https://www.familysearch.org/en/search/record/results?${p.toString()}`;
}

// --- DAR (Daughters of the American Revolution) -------------------------
// The DAR Genealogical Research System search is a POST form, so its query
// can't be deep-linked directly. A site-scoped web search is the reliable way
// to surface a named ancestor's DAR record(s).

export function darSearchUrl(f: ResearchFacts): string {
  const name = f.fullName || `${f.given} ${f.surname}`.trim();
  const p = new URLSearchParams();
  p.set('q', `site:services.dar.org ${name}`.trim());
  return `https://www.google.com/search?${p.toString()}`;
}
