// The GEDCOM parsing adapter — the ONLY file in @genealogy/core that imports the
// third-party parser. It walks read-gedcom's normalized tree and constructs our
// own GenealogyModel; the library's types never leak past this file (TRD §7.1).
//
// Robustness contract (TRD §2, §7.3): never hard-fail. Unrecognized tags and
// dangling pointers become ParseWarnings; a partially-readable file still
// produces a usable model. Raw source strings are always preserved (TRD §5).
import { parseGedcom as parseGedcomTree } from 'read-gedcom';
import type {
  Event,
  EventType,
  Family,
  GenealogyModel,
  ParseWarning,
  Person,
  PersonName,
  Place,
  SourceCitation,
} from '../types/index.js';
import { parseGedcomDate } from './date.js';
import { internPlace } from './place.js';
import { parsePersonName, parseSex } from './name.js';

/**
 * A minimal, local view of read-gedcom's tree node. Declaring it here (rather
 * than importing the library's type) keeps the library's types fully contained
 * within this adapter, satisfying the "never leak past the adapter" rule.
 */
interface RawNode {
  tag: string | null;
  pointer: string | null;
  value: string | null;
  children: RawNode[];
}

// ---- Tag tables --------------------------------------------------------

/** Individual event tags → normalized EventType (TRD §7.2). */
const INDIVIDUAL_EVENT_TYPES: Record<string, EventType> = {
  BIRT: 'birth',
  DEAT: 'death',
  BURI: 'burial',
  BAPM: 'baptism',
  CHR: 'baptism',
  CHRA: 'baptism',
  BAPL: 'baptism',
  CENS: 'census',
  RESI: 'residence',
  IMMI: 'immigration',
  EMIG: 'emigration',
  OCCU: 'occupation',
  MILI: 'military',
  _MILT: 'military',
};

/** Family event tags → EventType. */
const FAMILY_EVENT_TYPES: Record<string, EventType> = {
  MARR: 'marriage',
};

/**
 * Individual sub-tags that are structural/attribute data, not events. Anything
 * not listed here and not an event tag is treated defensively (see below).
 */
const INDI_NON_EVENT_TAGS = new Set([
  'NAME',
  'SEX',
  'FAMS',
  'FAMC',
  'SOUR',
  'NOTE',
  'OBJE',
  'RIN',
  'REFN',
  'RFN',
  'AFN',
  'UID',
  '_UID',
  'CHAN',
  'ADDR',
  'TITL',
]);

// ---- Small tree helpers ------------------------------------------------

const childrenByTag = (node: RawNode, tag: string): RawNode[] =>
  node.children.filter((c) => c.tag === tag);

const firstChild = (node: RawNode, tag: string): RawNode | undefined =>
  node.children.find((c) => c.tag === tag);

const firstValue = (node: RawNode, tag: string): string | undefined =>
  firstChild(node, tag)?.value ?? undefined;

/** Strip the surrounding @…@ from an xref pointer: "@I1@" → "I1". */
const stripXref = (raw: string | null | undefined): string =>
  (raw ?? '').replace(/^@/, '').replace(/@$/, '');

// ---- Input normalization ----------------------------------------------

/**
 * Accept a string (the documented default, encoded as UTF-8), or raw bytes
 * (ArrayBuffer / Uint8Array) so read-gedcom's charset auto-detection can handle
 * legacy encodings such as ANSEL (TRD §7.3). See DEVIATIONS.md.
 */
function toArrayBuffer(input: string | ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  // Copy into a fresh, non-shared ArrayBuffer so the result is exactly the
  // backing bytes (handles Uint8Array views with a non-zero byteOffset, and
  // avoids the SharedArrayBuffer branch of ArrayBufferLike).
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

// ---- Event / place / source extraction --------------------------------

function extractPlace(
  eventNode: RawNode,
  places: Map<string, Place>,
): Place | undefined {
  const raw = firstValue(eventNode, 'PLAC');
  if (raw === undefined) return undefined;
  return internPlace(places, raw);
}

function extractSources(node: RawNode): SourceCitation[] {
  return childrenByTag(node, 'SOUR').map((sourNode) => {
    const value = sourNode.value ?? '';
    const citation: SourceCitation = { raw: value };
    if (value.startsWith('@')) citation.sourceId = stripXref(value);
    const page = firstValue(sourNode, 'PAGE');
    if (page !== undefined) citation.page = page;
    return citation;
  });
}

/** Build an Event from an event-bearing sub-node. */
function buildEvent(
  id: string,
  type: EventType,
  node: RawNode,
  participants: string[],
  places: Map<string, Place>,
): Event {
  const event: Event = {
    id,
    type,
    rawTag: node.tag ?? '',
    participants,
    sources: extractSources(node),
  };
  const dateRaw = firstValue(node, 'DATE');
  if (dateRaw !== undefined) event.date = parseGedcomDate(dateRaw);
  const place = extractPlace(node, places);
  if (place !== undefined) event.place = place;
  // A value on the event line, or a TYPE sub-tag, becomes the description.
  const description = node.value ?? firstValue(node, 'TYPE');
  if (description) event.description = description;
  return event;
}

// ---- Record parsers ----------------------------------------------------

function parseHeader(node: RawNode): GenealogyModel['header'] {
  const header: NonNullable<GenealogyModel['header']> = {};
  const sourceSystem = firstValue(node, 'SOUR');
  if (sourceSystem !== undefined) header.sourceSystem = sourceSystem;
  const gedc = firstChild(node, 'GEDC');
  const version = gedc ? firstValue(gedc, 'VERS') : undefined;
  if (version !== undefined) header.gedcomVersion = version;
  const charset = firstValue(node, 'CHAR');
  if (charset !== undefined) header.charset = charset;
  const root = firstValue(node, '_ROOT');
  if (root !== undefined) header.rootPersonId = stripXref(root);
  return header;
}

function parseIndividual(node: RawNode, model: GenealogyModel): void {
  const id = stripXref(node.pointer);
  if (!id) {
    model.warnings.push({
      severity: 'info',
      message: 'Skipped an INDI record with no xref pointer.',
    });
    return;
  }

  const names: PersonName[] = childrenByTag(node, 'NAME').map((nameNode, i) =>
    parsePersonName(nameNode.value ?? '', i === 0),
  );
  if (names.length === 0) {
    model.warnings.push({
      severity: 'info',
      message: `Individual @${id}@ has no NAME record.`,
      context: `@${id}@`,
    });
  }

  const person: Person = {
    id,
    externalId: node.pointer ?? `@${id}@`,
    names,
    sex: parseSex(firstValue(node, 'SEX')),
    eventIds: [],
    familyIdsAsSpouse: childrenByTag(node, 'FAMS').map((c) => stripXref(c.value)),
    sources: extractSources(node),
  };

  const famc = childrenByTag(node, 'FAMC');
  if (famc.length > 0) {
    person.familyIdAsChild = stripXref(famc[0]!.value);
    if (famc.length > 1) {
      model.warnings.push({
        severity: 'info',
        message: `Individual @${id}@ has multiple FAMC pointers; using the first.`,
        context: `@${id}@`,
      });
    }
  }

  const notes = childrenByTag(node, 'NOTE')
    .map((n) => n.value)
    .filter((v): v is string => v !== null);
  if (notes.length > 0) person.notes = notes;

  // Events: known event tags, plus a defensive 'other' fallback for unknown
  // tags that carry a DATE or PLACe (so vendor event tags are not lost).
  const eventCounters = new Map<string, number>();
  for (const child of node.children) {
    const tag = child.tag ?? '';
    let type = INDIVIDUAL_EVENT_TYPES[tag];
    if (type === undefined) {
      if (INDI_NON_EVENT_TAGS.has(tag) || tag.startsWith('_')) {
        if (tag.startsWith('_') && !(tag in INDIVIDUAL_EVENT_TYPES)) {
          model.warnings.push({
            severity: 'info',
            message: `Vendor-specific tag ${tag} on @${id}@ was not mapped.`,
            context: `@${id}@`,
          });
        }
        continue;
      }
      const looksLikeEvent =
        firstChild(child, 'DATE') !== undefined ||
        firstChild(child, 'PLAC') !== undefined ||
        tag === 'EVEN';
      if (!looksLikeEvent) {
        model.warnings.push({
          severity: 'info',
          message: `Unrecognized tag ${tag} on @${id}@ was ignored.`,
          context: `@${id}@`,
        });
        continue;
      }
      type = 'other';
    }
    const n = eventCounters.get(tag) ?? 0;
    eventCounters.set(tag, n + 1);
    const eventId = `${id}-${tag}-${n}`;
    const event = buildEvent(eventId, type, child, [id], model.places);
    model.events.set(eventId, event);
    person.eventIds.push(eventId);
  }

  model.persons.set(id, person);
}

function parseFamily(node: RawNode, model: GenealogyModel): void {
  const id = stripXref(node.pointer);
  if (!id) {
    model.warnings.push({
      severity: 'info',
      message: 'Skipped a FAM record with no xref pointer.',
    });
    return;
  }

  const spouseIds = [
    ...childrenByTag(node, 'HUSB').map((c) => stripXref(c.value)),
    ...childrenByTag(node, 'WIFE').map((c) => stripXref(c.value)),
  ].filter((s) => s.length > 0);
  const childIds = childrenByTag(node, 'CHIL')
    .map((c) => stripXref(c.value))
    .filter((s) => s.length > 0);

  const family: Family = {
    id,
    externalId: node.pointer ?? `@${id}@`,
    spouseIds,
    childIds,
    marriageEventIds: [],
  };

  const eventCounters = new Map<string, number>();
  for (const child of node.children) {
    const tag = child.tag ?? '';
    const type = FAMILY_EVENT_TYPES[tag];
    if (type === undefined) continue;
    const n = eventCounters.get(tag) ?? 0;
    eventCounters.set(tag, n + 1);
    const eventId = `${id}-${tag}-${n}`;
    const event = buildEvent(eventId, type, child, [...spouseIds], model.places);
    model.events.set(eventId, event);
    family.marriageEventIds.push(eventId);
  }

  model.families.set(id, family);
}

// ---- Reference validation (dangling pointers → warnings) --------------

function validateReferences(model: GenealogyModel): void {
  const warn = (message: string, context: string): void => {
    model.warnings.push({ severity: 'warning', message, context });
  };
  for (const person of model.persons.values()) {
    for (const famId of person.familyIdsAsSpouse) {
      if (!model.families.has(famId)) {
        warn(
          `Individual @${person.id}@ references a missing family @${famId}@ (FAMS).`,
          `@${famId}@`,
        );
      }
    }
    if (person.familyIdAsChild && !model.families.has(person.familyIdAsChild)) {
      warn(
        `Individual @${person.id}@ references a missing family @${person.familyIdAsChild}@ (FAMC).`,
        `@${person.familyIdAsChild}@`,
      );
    }
  }
  for (const family of model.families.values()) {
    for (const spouseId of family.spouseIds) {
      if (!model.persons.has(spouseId)) {
        warn(
          `Family @${family.id}@ references a missing spouse @${spouseId}@.`,
          `@${spouseId}@`,
        );
      }
    }
    for (const childId of family.childIds) {
      if (!model.persons.has(childId)) {
        warn(
          `Family @${family.id}@ references a missing child @${childId}@.`,
          `@${childId}@`,
        );
      }
    }
  }
}

// ---- Public entry point ------------------------------------------------

export function parseGedcom(input: string | ArrayBuffer | Uint8Array): GenealogyModel {
  const warnings: ParseWarning[] = [];
  const model: GenealogyModel = {
    persons: new Map(),
    families: new Map(),
    events: new Map(),
    places: new Map(),
    warnings,
  };

  let root: RawNode;
  try {
    root = parseGedcomTree(toArrayBuffer(input)) as unknown as RawNode;
  } catch (err) {
    warnings.push({
      severity: 'warning',
      message: `GEDCOM could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return model;
  }

  for (const record of root.children) {
    switch (record.tag) {
      case 'HEAD':
        model.header = parseHeader(record);
        break;
      case 'INDI':
        parseIndividual(record, model);
        break;
      case 'FAM':
        parseFamily(record, model);
        break;
      case 'TRLR':
      case 'SOUR':
      case 'REPO':
      case 'OBJE':
      case 'NOTE':
      case 'SUBM':
      case 'SUBN':
        break; // known record types not modeled as entities in Step One
      default:
        if (record.tag) {
          warnings.push({
            severity: 'info',
            message: `Unrecognized top-level record ${record.tag} was ignored.`,
            context: record.pointer ?? undefined,
          });
        }
    }
  }

  validateReferences(model);
  return model;
}
