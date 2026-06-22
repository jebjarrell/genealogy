import type { GenealogyModel } from '../types/model.js';
import type { Person } from '../types/persons.js';
import type { Family } from '../types/families.js';
import type { Event } from '../types/events.js';
import type { SourceCitation } from '../types/sources.js';

// Serialize the (possibly merged) model back to GEDCOM 5.5.1.
//
// FIDELITY CAVEAT (documented in DEVIATIONS): this writes the fields the app
// MODELS — names, sex, events (date·place·source), family links, notes. GEDCOM
// custom/unmodeled sub-tags from the original file are not retained, so this is
// a *derived* export, not a byte-faithful round-trip. The JSON export is the
// lossless option for this app's own model.

/** One GEDCOM line; values are flattened to a single physical line. */
function line(level: number, tag: string, value?: string): string {
  const v = value !== undefined && value !== '' ? ` ${sanitize(value)}` : '';
  return `${level} ${tag}${v}`;
}

/** GEDCOM lines cannot contain raw newlines; collapse them. */
function sanitize(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim();
}

function xref(id: string): string {
  return `@${id}@`;
}

function writeSources(level: number, sources: SourceCitation[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    if (s.sourceId) {
      out.push(line(level, 'SOUR', xref(s.sourceId)));
      if (s.page) out.push(line(level + 1, 'PAGE', s.page));
    } else if (s.raw) {
      out.push(line(level, 'SOUR', s.raw));
      if (s.page) out.push(line(level + 1, 'PAGE', s.page));
    }
  }
  return out;
}

/** Write an event as `1 <TAG>` with DATE/PLAC/SOUR sub-lines. */
function writeEvent(event: Event): string[] {
  const out = [line(1, event.rawTag || 'EVEN', event.description)];
  if (event.date?.raw) out.push(line(2, 'DATE', event.date.raw));
  if (event.place?.raw) out.push(line(2, 'PLAC', event.place.raw));
  out.push(...writeSources(2, event.sources));
  return out;
}

function writePerson(person: Person, model: GenealogyModel): string[] {
  const out = [line(0, xref(person.id), 'INDI')];

  for (const name of person.names) {
    out.push(line(1, 'NAME', name.raw || name.full));
  }
  if (person.sex === 'male') out.push(line(1, 'SEX', 'M'));
  else if (person.sex === 'female') out.push(line(1, 'SEX', 'F'));

  for (const eventId of person.eventIds) {
    const event = model.events.get(eventId);
    if (event) out.push(...writeEvent(event));
  }

  if (person.familyIdAsChild) out.push(line(1, 'FAMC', xref(person.familyIdAsChild)));
  for (const famId of person.familyIdsAsSpouse) {
    out.push(line(1, 'FAMS', xref(famId)));
  }
  for (const note of person.notes ?? []) out.push(line(1, 'NOTE', note));
  out.push(...writeSources(1, person.sources));

  return out;
}

function writeFamily(family: Family, model: GenealogyModel): string[] {
  const out = [line(0, xref(family.id), 'FAM')];

  // Assign HUSB/WIFE by the spouse's sex, falling back to position.
  let husbWritten = false;
  for (const spouseId of family.spouseIds) {
    const sex = model.persons.get(spouseId)?.sex;
    const role = sex === 'female' ? 'WIFE' : sex === 'male' ? 'HUSB' : husbWritten ? 'WIFE' : 'HUSB';
    if (role === 'HUSB') husbWritten = true;
    out.push(line(1, role, xref(spouseId)));
  }
  for (const childId of family.childIds) out.push(line(1, 'CHIL', xref(childId)));
  for (const eventId of family.marriageEventIds) {
    const event = model.events.get(eventId);
    if (event) out.push(...writeEvent(event));
  }

  return out;
}

/** Serialize a model to a GEDCOM 5.5.1 string. */
export function writeGedcom(model: GenealogyModel): string {
  const lines: string[] = [
    line(0, 'HEAD'),
    line(1, 'SOUR', model.header?.sourceSystem ?? 'GenealogyKnowledgeGraph'),
    line(1, 'GEDC'),
    line(2, 'VERS', '5.5.1'),
    line(2, 'FORM', 'LINEAGE-LINKED'),
    line(1, 'CHAR', 'UTF-8'),
  ];

  for (const person of model.persons.values()) lines.push(...writePerson(person, model));
  for (const family of model.families.values()) lines.push(...writeFamily(family, model));

  lines.push(line(0, 'TRLR'));
  return lines.join('\n') + '\n';
}
