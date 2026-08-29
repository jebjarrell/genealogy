import { useEffect, useState } from 'react';
import {
  coParentsOf,
  describeRelationship,
  findParentChildFamily,
  findSpouseFamily,
} from '@genealogy/core';
import { useStore } from '../state/store.js';
import { primaryName } from '../graph/personDisplay.js';

// The parents / spouses / children lists on the detail panel, and the only place
// a relationship can be removed.
//
// GEDCOM has no direct person-to-person relationship record: everything runs
// through a family. So removing a link always means removing someone from a FAM,
// and that has consequences the row cannot show in a button label - detaching a
// child removes the whole couple; removing a spouse also stops them being a
// parent of that family's children. Every removal states its consequence in full
// before it can be confirmed.

/**
 * Which side of a relationship this list shows, so a row knows both ends of the
 * link it would sever. Omitted for lists that cannot be detached.
 */
export type Detach =
  | { direction: 'parent'; childId: string }
  | { direction: 'child'; parentId: string }
  | { direction: 'spouse'; personId: string };

interface RemovalPlan {
  familyId: string;
  /** Full sentence naming both people and everything else affected. */
  consequence: string;
  /** Applies the removal. */
  apply: () => void;
}

export function RelationshipList({
  title,
  ids,
  detach,
}: {
  title: string;
  ids: string[];
  detach?: Detach;
}) {
  const model = useStore((s) => s.model);
  const graph = useStore((s) => s.graph);
  const focalPersonId = useStore((s) => s.focalPersonId);
  const selectPerson = useStore((s) => s.selectPerson);
  const unlinkRelationship = useStore((s) => s.unlinkRelationship);
  // One row armed at a time, so a stray click cannot confirm a different row
  // than the one the user was reading.
  const [armed, setArmed] = useState<string | null>(null);

  // Selecting a different person swaps the list out from under an armed row.
  // Without this the confirmation stays open, retargeted at whoever is now in
  // that position - a live Remove button describing something the user never
  // armed. Keyed on content rather than the array identity, which changes every
  // render.
  const subject = detach
    ? `${detach.direction}:${'childId' in detach ? detach.childId : 'parentId' in detach ? detach.parentId : detach.personId}`
    : '';
  const rowKey = `${subject}|${ids.join(',')}`;
  useEffect(() => setArmed(null), [rowKey]);

  if (!model || ids.length === 0) return null;

  const nameOf = (id: string) => {
    const p = model.persons.get(id);
    return p ? primaryName(p) : id;
  };
  const listNames = (idList: string[]) => idList.map(nameOf).join(' and ');

  /**
   * What removing the link on this row would do, or null when the row has no
   * removable link. Used both to decide whether to offer the control and to
   * describe it once armed, so the two can never disagree.
   */
  function planFor(rowId: string): RemovalPlan | null {
    if (!detach || !graph || !model) return null;

    if (detach.direction === 'spouse') {
      const familyId = findSpouseFamily(graph, detach.personId, rowId);
      if (!familyId) return null;
      const children = model.families.get(familyId)?.childIds ?? [];
      const base = `Remove ${nameOf(rowId)} as a spouse of ${nameOf(detach.personId)}?`;
      return {
        familyId,
        consequence:
          children.length > 0
            ? `${base} They also stop being recorded as a parent of ${
                children.length === 1
                  ? 'their child'
                  : `their ${children.length} children`
              }, because GEDCOM stores the marriage and the children as one family.`
            : base,
        apply: () => unlinkRelationship(familyId, 'spouse', { spouseAId: rowId }),
      };
    }

    const parentId = detach.direction === 'parent' ? rowId : detach.parentId;
    const childId = detach.direction === 'child' ? rowId : detach.childId;
    const familyId = findParentChildFamily(graph, parentId, childId);
    if (!familyId) return null;

    const alsoRemoved = coParentsOf(model, familyId, parentId).filter((id) =>
      model.persons.has(id),
    );
    const base = `Remove ${nameOf(parentId)} as a parent of ${nameOf(childId)}?`;
    return {
      familyId,
      consequence:
        alsoRemoved.length > 0
          ? `${base} This also removes ${listNames(alsoRemoved)}, because GEDCOM records them as one couple.`
          : base,
      // Only the child is detached: removing the parent instead would strip them
      // from the family entirely, orphaning their other children.
      apply: () => unlinkRelationship(familyId, 'parent-child', { childId }),
    };
  }

  const armedPlan = armed === null ? null : planFor(armed);

  return (
    <div className="mt-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </div>
      <ul className="mt-1 space-y-0.5">
        {ids.map((id) => {
          const person = model.persons.get(id);
          if (!person) return null;
          const rel =
            graph && focalPersonId && focalPersonId !== id
              ? describeRelationship(graph, model, focalPersonId, id)
              : null;
          const removable = planFor(id) !== null;

          return (
            <li key={id} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0">
                <button
                  className="text-left text-sm text-blue-700 hover:underline"
                  onClick={() => selectPerson(id)}
                >
                  {primaryName(person)}
                </button>
                {rel && <span className="ml-1 text-xs text-gray-400">({rel})</span>}
              </span>
              {removable && armed !== id && (
                <button
                  className="shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 hover:border-red-300 hover:text-red-600"
                  title={`Remove this ${detach!.direction} link`}
                  onClick={() => setArmed(id)}
                >
                  Remove…
                </button>
              )}
            </li>
          );
        })}

        {armedPlan && (
          <li className="mt-1 rounded bg-amber-50 p-2 text-[11px] leading-snug text-amber-900">
            <p>{armedPlan.consequence} You can undo it from the Review tab.</p>
            <span className="mt-1 flex gap-1">
              <button
                className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold text-white hover:bg-red-700"
                onClick={() => {
                  armedPlan.apply();
                  setArmed(null);
                }}
              >
                Remove
              </button>
              <button
                className="rounded border border-amber-300 px-1.5 py-0.5 text-[11px] hover:bg-amber-100"
                onClick={() => setArmed(null)}
              >
                Cancel
              </button>
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}
