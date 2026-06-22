import type { GenealogyModel } from '../types/model.js';
import type { Person } from '../types/persons.js';
import type { Family } from '../types/families.js';
import type { SourceCitation } from '../types/sources.js';

// Non-destructive person merge for the edit layer (TRD §1.3 extension).
//
// `mergePersons` is PURE: it never mutates its input, it returns a brand-new
// `GenealogyModel`. Combined with `applyMerges` (replay an op-log over the
// pristine parsed model) this keeps the originals sacred and makes every edit
// trivially reversible — undo is "drop the op and replay".

/** A single recorded merge: fold `mergeId` into `keepId`. */
export interface MergeOp {
  /** The record that survives. */
  keepId: string;
  /** The record absorbed into `keepId` and then removed. */
  mergeId: string;
  /** ISO timestamp, for the Review list. */
  at: string;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function sourceKey(s: SourceCitation): string {
  return `${s.sourceId ?? ''}|${s.page ?? ''}|${s.raw}`;
}

function dedupeSources(sources: SourceCitation[]): SourceCitation[] {
  const seen = new Set<string>();
  const out: SourceCitation[] = [];
  for (const s of sources) {
    const key = sourceKey(s);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

function shallowCloneModel(model: GenealogyModel): GenealogyModel {
  return {
    persons: new Map(model.persons),
    families: new Map(model.families),
    events: new Map(model.events),
    places: new Map(model.places),
    warnings: model.warnings,
    header: model.header,
  };
}

/** Build the surviving person record by folding `merge` into `keep`. */
function combinePersons(keep: Person, merge: Person): Person {
  const names = [...keep.names];
  const seenNames = new Set(names.map((n) => n.full || n.raw));
  for (const n of merge.names) {
    const key = n.full || n.raw;
    if (!seenNames.has(key)) {
      seenNames.add(key);
      names.push({ ...n, isPrimary: false }); // keep's primary stays primary
    }
  }

  const notes = uniqueStrings([...(keep.notes ?? []), ...(merge.notes ?? [])]);
  const mergedFromIds = uniqueStrings([
    ...(keep.mergedFromIds ?? []),
    merge.id,
    ...(merge.mergedFromIds ?? []),
  ]);

  const combined: Person = {
    ...keep,
    names,
    sex: keep.sex !== 'unknown' ? keep.sex : merge.sex,
    eventIds: uniqueStrings([...keep.eventIds, ...merge.eventIds]),
    familyIdsAsSpouse: uniqueStrings([
      ...keep.familyIdsAsSpouse,
      ...merge.familyIdsAsSpouse,
    ]),
    sources: dedupeSources([...keep.sources, ...merge.sources]),
    mergedFromIds,
  };
  // FAMC: keep target's; fall back to source's only if target has none.
  const familyIdAsChild = keep.familyIdAsChild ?? merge.familyIdAsChild;
  if (familyIdAsChild !== undefined) combined.familyIdAsChild = familyIdAsChild;
  else delete combined.familyIdAsChild;
  if (notes.length > 0) combined.notes = notes;
  else delete combined.notes;
  return combined;
}

/** Rewrite `mergeId → keepId` in a family, dropping any self-as-own-child loop. */
function rewriteFamily(fam: Family, keepId: string, mergeId: string): Family | null {
  const hasSpouse = fam.spouseIds.includes(mergeId);
  const hasChild = fam.childIds.includes(mergeId);
  if (!hasSpouse && !hasChild) return null;

  const spouseIds = uniqueStrings(
    fam.spouseIds.map((id) => (id === mergeId ? keepId : id)),
  );
  let childIds = uniqueStrings(
    fam.childIds.map((id) => (id === mergeId ? keepId : id)),
  );
  // A person cannot be their own parent: if keepId is now both a spouse and a
  // child of this family (the two merged records were parent & child), drop the
  // child link.
  if (spouseIds.includes(keepId)) {
    childIds = childIds.filter((id) => id !== keepId);
  }
  return { ...fam, spouseIds, childIds };
}

/**
 * Fold `mergeId` into `keepId`, returning a NEW model. No-op (returns the input
 * model unchanged) when ids are equal or either record is missing — which makes
 * replay resilient to ops that reference already-merged records.
 */
export function mergePersons(
  model: GenealogyModel,
  keepId: string,
  mergeId: string,
): GenealogyModel {
  if (keepId === mergeId) return model;
  const keep = model.persons.get(keepId);
  const merge = model.persons.get(mergeId);
  if (!keep || !merge) return model;

  const next = shallowCloneModel(model);

  // 1. Combine the two person records.
  const combined = combinePersons(keep, merge);
  next.persons.set(keepId, combined);
  next.persons.delete(mergeId);

  // 2. Rewrite family references (spouse/child) and clean self-loops.
  for (const [fid, fam] of model.families) {
    const rewritten = rewriteFamily(fam, keepId, mergeId);
    if (rewritten) next.families.set(fid, rewritten);
  }

  // 3. If keepId is now a spouse in its own child-family, that FAMC is a
  //    self-loop — clear it.
  if (
    combined.familyIdAsChild !== undefined &&
    next.families.get(combined.familyIdAsChild)?.spouseIds.includes(keepId)
  ) {
    const fixed = { ...combined };
    delete fixed.familyIdAsChild;
    next.persons.set(keepId, fixed);
  }

  // 4. Rewrite event participants.
  for (const [eid, ev] of model.events) {
    if (ev.participants.includes(mergeId)) {
      next.events.set(eid, {
        ...ev,
        participants: uniqueStrings(
          ev.participants.map((id) => (id === mergeId ? keepId : id)),
        ),
      });
    }
  }

  return next;
}

/**
 * Replay an ordered op-log over a base model. Ops whose records no longer exist
 * are skipped, so the result is always well-formed even after earlier merges
 * removed a referenced id. Deterministic for a given (base, ops).
 */
export function applyMerges(base: GenealogyModel, ops: MergeOp[]): GenealogyModel {
  return ops.reduce((m, op) => mergePersons(m, op.keepId, op.mergeId), base);
}
