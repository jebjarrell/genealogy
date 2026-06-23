import type { GenealogyModel } from '../types/model.js';
import type { Graph } from '../types/graph.js';
import type { Event, EventType } from '../types/events.js';
import type { Person } from '../types/persons.js';
import { enumerateAncestralPaths } from '../graph/paths.js';
import type { EnumeratePathsOptions } from '../graph/paths.js';

// Locality research report (handoff §4): "where do I dig next". A pure projection
// over existing data — NO external calls, NO hint scraping.
//
// The input is a traced line: a specific ancestor. The people on that line come
// from the ENUMERATED relationship paths between the focal person and the
// ancestor (NOT a naive ancestor-set walk), then deduplicated — so pedigree
// collapse does not double-count an ancestor reached by multiple routes. Every
// place-bearing event along the line becomes a fact, pivoted place → year →
// person, with a citation status. The gaps (`unsourced` / `none`) ARE the
// deliverable: the research to-do list.

export type CitationStatus = 'sourced' | 'unsourced' | 'none';

/** The vital facts we expect for everyone on a line; their absence is a `none`. */
const UNIVERSAL_VITALS: EventType[] = ['birth', 'death'];

export interface LocalityFact {
  personId: string;
  personName: string;
  /** Absent for a `none` (missing-record) fact. */
  eventId?: string;
  eventType: EventType;
  dateRaw?: string;
  year?: number;
  /** Normalized place key ('' when the place/record is unknown). */
  placeKey: string;
  placeLabel: string;
  status: CitationStatus;
}

export interface LocalityRow {
  placeKey: string;
  placeLabel: string;
  /** Sorted by year, then person, then event type. */
  facts: LocalityFact[];
  /** Distinct person ids appearing in this place. */
  people: string[];
  /** True when the place has no sourced fact at all — a research target. */
  isResearchTarget: boolean;
}

export interface LocalityReport {
  focalId: string;
  ancestorId: string;
  /** People on the line, deduplicated across braided/collapsed paths. */
  personIds: string[];
  rows: LocalityRow[];
  /** True when path enumeration was capped. */
  truncated: boolean;
  /** Facts that still need work (status !== 'sourced'). */
  gapCount: number;
}

function primaryName(person: Person): string {
  const n = person.names[0];
  return (n?.full || n?.raw || person.id).trim() || person.id;
}

/** Every event a person participates in (individual + family marriages), unique. */
function collectPersonEvents(model: GenealogyModel, person: Person): Event[] {
  const seen = new Set<string>();
  const events: Event[] = [];
  const add = (id: string): void => {
    if (seen.has(id)) return;
    const ev = model.events.get(id);
    if (ev) {
      seen.add(id);
      events.push(ev);
    }
  };
  for (const id of person.eventIds) add(id);
  for (const famId of person.familyIdsAsSpouse) {
    for (const id of model.families.get(famId)?.marriageEventIds ?? []) add(id);
  }
  return events;
}

/** Build the deduplicated set of people on the traced line, collapse-safe. */
function peopleOnLine(
  graph: Graph,
  focalId: string,
  ancestorId: string,
  options?: EnumeratePathsOptions,
): { ids: string[]; truncated: boolean } {
  if (focalId === ancestorId) return { ids: [focalId], truncated: false };
  const { paths, truncated } = enumerateAncestralPaths(
    graph,
    focalId,
    ancestorId,
    options,
  );
  const ids = new Set<string>();
  for (const path of paths) {
    for (const step of path.steps) ids.add(step.personId);
  }
  return { ids: [...ids], truncated };
}

/**
 * Build the locality research report for the line focal → ancestor. Consumes
 * enumerated paths (no collapse double-counting); pivots place → year → person;
 * surfaces unsourced and missing-record cells as research targets.
 */
export function buildLocalityReport(
  model: GenealogyModel,
  graph: Graph,
  focalId: string,
  ancestorId: string,
  options?: EnumeratePathsOptions,
): LocalityReport {
  const { ids: personIds, truncated } = peopleOnLine(
    graph,
    focalId,
    ancestorId,
    options,
  );

  const facts: LocalityFact[] = [];

  for (const personId of personIds) {
    const person = model.persons.get(personId);
    if (!person) continue;
    const personName = primaryName(person);
    const events = collectPersonEvents(model, person);
    const typesPresent = new Set(events.map((e) => e.type));

    for (const ev of events) {
      const place = ev.place;
      const fact: LocalityFact = {
        personId,
        personName,
        eventId: ev.id,
        eventType: ev.type,
        placeKey: place?.normalized ?? '',
        placeLabel: place?.raw ?? '(place unknown)',
        status: ev.sources.length > 0 ? 'sourced' : 'unsourced',
      };
      if (ev.date?.raw !== undefined) fact.dateRaw = ev.date.raw;
      if (ev.date?.year !== undefined) fact.year = ev.date.year;
      facts.push(fact);
    }

    // Missing-record (`none`) research targets: universal vitals everyone should
    // have, plus a marriage when the person has a spouse-family but no marriage
    // event recorded.
    const missing: EventType[] = UNIVERSAL_VITALS.filter((t) => !typesPresent.has(t));
    if (person.familyIdsAsSpouse.length > 0 && !typesPresent.has('marriage')) {
      missing.push('marriage');
    }
    for (const type of missing) {
      facts.push({
        personId,
        personName,
        eventType: type,
        placeKey: '',
        placeLabel: '(no record)',
        status: 'none',
      });
    }
  }

  // Pivot facts into place rows.
  const rowMap = new Map<string, LocalityFact[]>();
  for (const fact of facts) {
    const list = rowMap.get(fact.placeKey);
    if (list === undefined) rowMap.set(fact.placeKey, [fact]);
    else list.push(fact);
  }

  const rows: LocalityRow[] = [];
  for (const [placeKey, list] of rowMap) {
    list.sort(
      (a, b) =>
        (a.year ?? Number.MAX_SAFE_INTEGER) - (b.year ?? Number.MAX_SAFE_INTEGER) ||
        a.personName.localeCompare(b.personName) ||
        a.eventType.localeCompare(b.eventType),
    );
    const people = [...new Set(list.map((f) => f.personId))];
    rows.push({
      placeKey,
      placeLabel: list[0]!.placeLabel,
      facts: list,
      people,
      isResearchTarget: !list.some((f) => f.status === 'sourced'),
    });
  }

  // Sort rows by place; the unknown-place bucket ('') sorts last.
  rows.sort((a, b) => {
    if (a.placeKey === '' && b.placeKey !== '') return 1;
    if (b.placeKey === '' && a.placeKey !== '') return -1;
    return a.placeLabel.localeCompare(b.placeLabel);
  });

  const gapCount = facts.filter((f) => f.status !== 'sourced').length;

  return { focalId, ancestorId, personIds, rows, truncated, gapCount };
}

/** Render the report as a portable Markdown research plan (for export). */
export function localityReportToMarkdown(
  report: LocalityReport,
  title: string,
): string {
  const lines: string[] = [`# Locality research report — ${title}`, ''];
  lines.push(
    `People on this line: ${report.personIds.length}. ` +
      `Research gaps: ${report.gapCount}.`,
    '',
  );
  if (report.truncated) {
    lines.push('> Note: the line was deep enough that path enumeration was capped.', '');
  }
  for (const row of report.rows) {
    const flag = row.isResearchTarget ? '  ⚠ research target' : '';
    lines.push(`## ${row.placeLabel}${flag}`);
    for (const fact of row.facts) {
      const when = fact.dateRaw ?? (fact.year !== undefined ? String(fact.year) : '—');
      lines.push(
        `- ${fact.personName} · ${fact.eventType} · ${when} · **${fact.status}**`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
