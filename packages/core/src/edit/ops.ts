import type { GenealogyModel } from '../types/model.js';
import type { Person, Sex } from '../types/persons.js';
import type { Family } from '../types/families.js';
import type { Event, EventType } from '../types/events.js';
import { parsePersonName } from '../gedcom/name.js';
import { parseGedcomDate } from '../gedcom/date.js';
import { internPlace } from '../gedcom/place.js';
import { mergePersons } from './merge.js';

// The unified, non-destructive edit op-log (TRD §1.3 extension).
//
// The existing merge engine proved the pattern: never mutate the parsed model;
// record every change as an op and REPLAY the ordered op-log over the pristine
// `baseModel` to produce the working model. This module extends that single
// mechanism to manual data entry — adding/editing people, events, and
// relationships — so there is exactly ONE editing pattern, not two.
//
// Every applier is PURE: it clones the model and returns a NEW one, never
// touching its input. Every applier is RESILIENT: an op whose referents no
// longer exist (e.g. because an earlier op was undone) is a no-op, so replaying
// any prefix/sequence is always well-formed. Replay is DETERMINISTIC: the same
// (base, ops) always reproduces the exact same model — the op-log fidelity
// contract (TRD §8.2 / Section 8.2 of the handoff).
//
// Round-trip fidelity for dates, places, and names is guaranteed by storing the
// user's RAW input in the op and re-running the very same parsers the GEDCOM
// adapter uses (`parseGedcomDate`, `internPlace`, `parsePersonName`).

/** Fold `mergeId` into `keepId` (the original edit op; see edit/merge.ts). */
export interface MergeEditOp {
  kind: 'merge';
  keepId: string;
  mergeId: string;
  at: string;
}

/** Create a brand-new, user-supplied person. `personId` is assigned by the UI. */
export interface AddPersonOp {
  kind: 'addPerson';
  personId: string;
  /** GEDCOM NAME-style raw strings ("John /Smith/"); the first is primary. */
  nameRaws: string[];
  sex: Sex;
  notes?: string[];
  at: string;
}

/** Patch an existing person; only provided fields change. Flags it user-supplied. */
export interface EditPersonOp {
  kind: 'editPerson';
  personId: string;
  nameRaws?: string[];
  sex?: Sex;
  /** Replaces the notes list when present. */
  notes?: string[];
  at: string;
}

/** Create a user-supplied event and attach it to participants (or a family). */
export interface AddEventOp {
  kind: 'addEvent';
  eventId: string;
  eventType: EventType;
  /** GEDCOM tag; defaults from eventType when omitted. */
  rawTag?: string;
  participantIds: string[];
  /** Raw GEDCOM DATE value, parsed on replay (qualifiers round-trip exactly). */
  dateRaw?: string;
  /** Raw GEDCOM PLAC value, normalized on replay (parts/raw match the parser). */
  placeRaw?: string;
  description?: string;
  /** When set, the event is a family event (e.g. marriage) on this family. */
  familyId?: string;
  at: string;
}

/** Patch an existing event. `null` clears a field; `undefined` leaves it. */
export interface EditEventOp {
  kind: 'editEvent';
  eventId: string;
  eventType?: EventType;
  dateRaw?: string | null;
  placeRaw?: string | null;
  description?: string | null;
  at: string;
}

/** Link two people through a family (creating the family if needed). */
export interface LinkRelationshipOp {
  kind: 'linkRelationship';
  relation: 'parent-child' | 'spouse';
  /** The family that carries the link; created (user-supplied) when absent. */
  familyId: string;
  parentId?: string;
  childId?: string;
  spouseAId?: string;
  spouseBId?: string;
  at: string;
}

/** Remove a previously-existing link (the inverse of a link, for clean undo). */
export interface UnlinkRelationshipOp {
  kind: 'unlinkRelationship';
  relation: 'parent-child' | 'spouse';
  familyId: string;
  parentId?: string;
  childId?: string;
  spouseAId?: string;
  spouseBId?: string;
  at: string;
}

export type EditOp =
  | MergeEditOp
  | AddPersonOp
  | EditPersonOp
  | AddEventOp
  | EditEventOp
  | LinkRelationshipOp
  | UnlinkRelationshipOp;

/** Shallow-clone the model's containers; values are replaced, never mutated. */
function cloneModel(model: GenealogyModel): GenealogyModel {
  const next: GenealogyModel = {
    persons: new Map(model.persons),
    families: new Map(model.families),
    events: new Map(model.events),
    places: new Map(model.places),
    warnings: model.warnings,
  };
  if (model.header !== undefined) next.header = model.header;
  return next;
}

/** Default GEDCOM tag for an event type (used when an addEvent omits rawTag). */
const DEFAULT_TAG: Record<EventType, string> = {
  birth: 'BIRT',
  death: 'DEAT',
  marriage: 'MARR',
  burial: 'BURI',
  baptism: 'BAPM',
  census: 'CENS',
  residence: 'RESI',
  immigration: 'IMMI',
  emigration: 'EMIG',
  military: 'MILI',
  occupation: 'OCCU',
  other: 'EVEN',
};

function applyAddPerson(model: GenealogyModel, op: AddPersonOp): GenealogyModel {
  if (model.persons.has(op.personId)) return model; // idempotent: already present
  const next = cloneModel(model);
  const names = op.nameRaws.map((raw, i) => parsePersonName(raw, i === 0));
  const person: Person = {
    id: op.personId,
    externalId: `@${op.personId}@`,
    names,
    sex: op.sex,
    eventIds: [],
    familyIdsAsSpouse: [],
    sources: [],
    userSupplied: true,
  };
  if (op.notes && op.notes.length > 0) person.notes = [...op.notes];
  next.persons.set(op.personId, person);
  return next;
}

function applyEditPerson(model: GenealogyModel, op: EditPersonOp): GenealogyModel {
  const existing = model.persons.get(op.personId);
  if (!existing) return model;
  const next = cloneModel(model);
  const updated: Person = { ...existing, userSupplied: true };
  if (op.nameRaws !== undefined) {
    updated.names = op.nameRaws.map((raw, i) => parsePersonName(raw, i === 0));
  }
  if (op.sex !== undefined) updated.sex = op.sex;
  if (op.notes !== undefined) {
    if (op.notes.length > 0) updated.notes = [...op.notes];
    else delete updated.notes;
  }
  next.persons.set(op.personId, updated);
  return next;
}

function applyAddEvent(model: GenealogyModel, op: AddEventOp): GenealogyModel {
  if (model.events.has(op.eventId)) return model;
  const next = cloneModel(model);
  const participants = op.participantIds.filter((id) => next.persons.has(id));
  const event: Event = {
    id: op.eventId,
    type: op.eventType,
    rawTag: op.rawTag ?? DEFAULT_TAG[op.eventType],
    participants,
    sources: [],
    userSupplied: true,
  };
  if (op.dateRaw) event.date = parseGedcomDate(op.dateRaw);
  if (op.placeRaw) event.place = internPlace(next.places, op.placeRaw);
  if (op.description) event.description = op.description;
  next.events.set(op.eventId, event);

  if (op.familyId) {
    const fam = next.families.get(op.familyId);
    if (fam && !fam.marriageEventIds.includes(op.eventId)) {
      next.families.set(op.familyId, {
        ...fam,
        marriageEventIds: [...fam.marriageEventIds, op.eventId],
      });
    }
  } else {
    for (const pid of participants) {
      const p = next.persons.get(pid)!;
      if (!p.eventIds.includes(op.eventId)) {
        next.persons.set(pid, { ...p, eventIds: [...p.eventIds, op.eventId] });
      }
    }
  }
  return next;
}

function applyEditEvent(model: GenealogyModel, op: EditEventOp): GenealogyModel {
  const existing = model.events.get(op.eventId);
  if (!existing) return model;
  const next = cloneModel(model);
  const updated: Event = { ...existing, userSupplied: true };
  if (op.eventType !== undefined) {
    updated.type = op.eventType;
    updated.rawTag = DEFAULT_TAG[op.eventType];
  }
  if (op.dateRaw !== undefined) {
    if (op.dateRaw === null) delete updated.date;
    else updated.date = parseGedcomDate(op.dateRaw);
  }
  if (op.placeRaw !== undefined) {
    if (op.placeRaw === null) delete updated.place;
    else updated.place = internPlace(next.places, op.placeRaw);
  }
  if (op.description !== undefined) {
    if (op.description === null) delete updated.description;
    else updated.description = op.description;
  }
  next.events.set(op.eventId, updated);
  return next;
}

/** Materialize a mutable copy of a family, creating a user-supplied one if new. */
function familyCopy(next: GenealogyModel, familyId: string): Family {
  const base = next.families.get(familyId);
  if (base) {
    return {
      ...base,
      spouseIds: [...base.spouseIds],
      childIds: [...base.childIds],
      marriageEventIds: [...base.marriageEventIds],
    };
  }
  return {
    id: familyId,
    externalId: `@${familyId}@`,
    spouseIds: [],
    childIds: [],
    marriageEventIds: [],
    userSupplied: true,
  };
}

function addSpouseLink(next: GenealogyModel, personId: string, familyId: string): void {
  const p = next.persons.get(personId);
  if (p && !p.familyIdsAsSpouse.includes(familyId)) {
    next.persons.set(personId, {
      ...p,
      familyIdsAsSpouse: [...p.familyIdsAsSpouse, familyId],
    });
  }
}

function applyLink(model: GenealogyModel, op: LinkRelationshipOp): GenealogyModel {
  const next = cloneModel(model);
  const fam = familyCopy(next, op.familyId);

  if (op.relation === 'parent-child') {
    const parentOk = op.parentId !== undefined && next.persons.has(op.parentId);
    const childOk = op.childId !== undefined && next.persons.has(op.childId);
    if (!parentOk && !childOk) return model; // nothing to link
    if (parentOk && !fam.spouseIds.includes(op.parentId!)) fam.spouseIds.push(op.parentId!);
    if (childOk && !fam.childIds.includes(op.childId!)) fam.childIds.push(op.childId!);
    next.families.set(op.familyId, fam);
    if (parentOk) addSpouseLink(next, op.parentId!, op.familyId);
    if (childOk) {
      const c = next.persons.get(op.childId!)!;
      if (c.familyIdAsChild !== op.familyId) {
        next.persons.set(op.childId!, { ...c, familyIdAsChild: op.familyId });
      }
    }
    return next;
  }

  // spouse
  const ids = [op.spouseAId, op.spouseBId].filter(
    (id): id is string => id !== undefined && next.persons.has(id),
  );
  if (ids.length === 0) return model;
  for (const id of ids) if (!fam.spouseIds.includes(id)) fam.spouseIds.push(id);
  next.families.set(op.familyId, fam);
  for (const id of ids) addSpouseLink(next, id, op.familyId);
  return next;
}

function applyUnlink(model: GenealogyModel, op: UnlinkRelationshipOp): GenealogyModel {
  const base = model.families.get(op.familyId);
  if (!base) return model;
  const next = cloneModel(model);
  const fam = familyCopy(next, op.familyId);

  const removeSpouseBacklink = (personId: string): void => {
    const p = next.persons.get(personId);
    if (p && p.familyIdsAsSpouse.includes(op.familyId)) {
      next.persons.set(personId, {
        ...p,
        familyIdsAsSpouse: p.familyIdsAsSpouse.filter((f) => f !== op.familyId),
      });
    }
  };

  if (op.relation === 'parent-child') {
    if (op.parentId !== undefined) {
      fam.spouseIds = fam.spouseIds.filter((id) => id !== op.parentId);
      removeSpouseBacklink(op.parentId);
    }
    if (op.childId !== undefined) {
      fam.childIds = fam.childIds.filter((id) => id !== op.childId);
      const c = next.persons.get(op.childId);
      if (c && c.familyIdAsChild === op.familyId) {
        const updated = { ...c };
        delete updated.familyIdAsChild;
        next.persons.set(op.childId, updated);
      }
    }
  } else {
    for (const id of [op.spouseAId, op.spouseBId]) {
      if (id === undefined) continue;
      fam.spouseIds = fam.spouseIds.filter((s) => s !== id);
      removeSpouseBacklink(id);
    }
  }
  next.families.set(op.familyId, fam);
  return next;
}

/** Apply a single edit op, returning a new model (pure; resilient to bad refs). */
export function applyOp(model: GenealogyModel, op: EditOp): GenealogyModel {
  switch (op.kind) {
    case 'merge':
      return mergePersons(model, op.keepId, op.mergeId);
    case 'addPerson':
      return applyAddPerson(model, op);
    case 'editPerson':
      return applyEditPerson(model, op);
    case 'addEvent':
      return applyAddEvent(model, op);
    case 'editEvent':
      return applyEditEvent(model, op);
    case 'linkRelationship':
      return applyLink(model, op);
    case 'unlinkRelationship':
      return applyUnlink(model, op);
  }
}

/**
 * Replay an ordered edit op-log over a pristine base model. Deterministic and
 * total: the same (base, ops) always yields the same model, and any op whose
 * referents are missing is skipped — so the result is always well-formed. This
 * is the single source of truth for the working model (TRD §8.2).
 */
export function applyOps(base: GenealogyModel, ops: EditOp[]): GenealogyModel {
  return ops.reduce((m, op) => applyOp(m, op), base);
}
