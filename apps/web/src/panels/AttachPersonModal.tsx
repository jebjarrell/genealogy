import { useState } from 'react';
import {
  candidateFamiliesForChild,
  candidateFamiliesForParent,
  checkParentChildLink,
  checkSpouseLink,
  type FamilyCandidate,
  type LinkIssue,
} from '@genealogy/core';
import { useStore } from '../state/store.js';
import { useEditorStore, type AttachRelation } from '../state/editorStore.js';
import { lifeSpan, primaryName } from '../graph/personDisplay.js';

// Attaching someone to an existing person. Search comes first because correcting
// an imported tree mostly means linking people who are already in the file;
// creating a new person is the fallback, and hands off to PersonEditor unchanged.
//
// Two things this modal must never do silently: pick a family when a remarriage
// makes the choice ambiguous, and let through a link that would make someone
// their own ancestor. The store refuses blocking links regardless, but the modal
// explains them rather than letting the attempt fail with a bare notice.

const RELATION_LABEL: Record<AttachRelation, string> = {
  parent: 'a parent of',
  child: 'a child of',
  spouse: 'a spouse of',
};

/** A new family, offered alongside any existing candidates. */
const NEW_FAMILY = '__new__';

export function AttachPersonModal() {
  const attach = useEditorStore((s) => s.attach);
  const closeAttach = useEditorStore((s) => s.closeAttach);
  const openAddPerson = useEditorStore((s) => s.openAddPerson);
  const model = useStore((s) => s.model);
  const graph = useStore((s) => s.graph);
  const search = useStore((s) => s.search);
  const linkRelationship = useStore((s) => s.linkRelationship);

  const [query, setQuery] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [familyChoice, setFamilyChoice] = useState<string | null>(null);

  if (!attach || !model || !graph) return null;

  const anchor = model.persons.get(attach.personId);
  if (!anchor) return null;

  const close = () => {
    setQuery('');
    setPickedId(null);
    setFamilyChoice(null);
    closeAttach();
  };

  const nameOf = (id: string) => {
    const p = model.persons.get(id);
    return p ? primaryName(p) : id;
  };

  // Candidate families depend on which end the new person joins: a new PARENT
  // joins a family the anchor is a child in; a new child or spouse joins one the
  // anchor is a spouse in.
  const candidates: FamilyCandidate[] =
    attach.relation === 'parent'
      ? candidateFamiliesForParent(model, attach.personId)
      : candidateFamiliesForChild(model, attach.personId);

  const issuesFor = (otherId: string): LinkIssue[] => {
    if (attach.relation === 'spouse') {
      return checkSpouseLink(model, graph, attach.personId, otherId);
    }
    return attach.relation === 'parent'
      ? checkParentChildLink(model, graph, otherId, attach.personId)
      : checkParentChildLink(model, graph, attach.personId, otherId);
  };

  const commit = (otherId: string, familyId: string | undefined) => {
    if (attach.relation === 'spouse') {
      linkRelationship(
        'spouse',
        { spouseAId: attach.personId, spouseBId: otherId },
        familyId,
      );
    } else if (attach.relation === 'parent') {
      linkRelationship(
        'parent-child',
        { parentId: otherId, childId: attach.personId },
        familyId,
      );
    } else {
      linkRelationship(
        'parent-child',
        { parentId: attach.personId, childId: otherId },
        familyId,
      );
    }
    close();
  };

  const results = query.trim() ? search(query) : [];
  const heading = `Add ${RELATION_LABEL[attach.relation]} ${primaryName(anchor)}`;

  // ---- Step 2: a person is picked; resolve family and validate -------------
  if (pickedId) {
    const issues = issuesFor(pickedId);
    const blocking = issues.filter((i) => i.severity === 'block');
    const warnings = issues.filter((i) => i.severity === 'warn');
    const mustChoose = blocking.length === 0 && candidates.length > 1;
    const chosen = mustChoose ? familyChoice : (candidates[0]?.familyId ?? NEW_FAMILY);

    return (
      <Shell heading={heading} onClose={close}>
        <p className="text-sm">
          <span className="font-semibold">{nameOf(pickedId)}</span> as{' '}
          {RELATION_LABEL[attach.relation]}{' '}
          <span className="font-semibold">{primaryName(anchor)}</span>
        </p>

        {blocking.length > 0 && (
          <div className="rounded bg-red-50 p-2 text-xs text-red-800">
            {blocking.map((i) => (
              <p key={i.message}>{i.message}</p>
            ))}
            <p className="mt-1 font-semibold">This link cannot be recorded.</p>
          </div>
        )}

        {blocking.length === 0 && warnings.length > 0 && (
          <div className="rounded bg-amber-50 p-2 text-xs text-amber-900">
            {warnings.map((i) => (
              <p key={i.message}>{i.message}</p>
            ))}
            <p className="mt-1">Link anyway?</p>
          </div>
        )}

        {mustChoose && (
          <fieldset className="rounded border border-gray-200 p-2">
            <legend className="px-1 text-xs font-semibold text-gray-500">
              Which family?
            </legend>
            {candidates.map((c) => (
              <label key={c.familyId} className="flex items-baseline gap-2 text-sm">
                <input
                  type="radio"
                  name="family"
                  value={c.familyId}
                  checked={familyChoice === c.familyId}
                  onChange={() => setFamilyChoice(c.familyId)}
                />
                <span>
                  {c.spouseIds.map(nameOf).join(' and ')}
                  <span className="ml-1 text-xs text-gray-400">
                    (
                    {c.childIds.length === 1
                      ? '1 child'
                      : `${c.childIds.length} children`}
                    )
                  </span>
                </span>
              </label>
            ))}
            <label className="flex items-baseline gap-2 text-sm">
              <input
                type="radio"
                name="family"
                value={NEW_FAMILY}
                checked={familyChoice === NEW_FAMILY}
                onChange={() => setFamilyChoice(NEW_FAMILY)}
              />
              <span>A new family</span>
            </label>
          </fieldset>
        )}

        <div className="flex justify-end gap-2">
          <button
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
            onClick={() => {
              setPickedId(null);
              setFamilyChoice(null);
            }}
          >
            Back
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            disabled={blocking.length > 0 || (mustChoose && chosen === null)}
            onClick={() =>
              commit(
                pickedId,
                chosen === NEW_FAMILY || chosen === null ? undefined : chosen,
              )
            }
          >
            Link
          </button>
        </div>
      </Shell>
    );
  }

  // ---- Step 1: search ------------------------------------------------------
  return (
    <Shell heading={heading} onClose={close}>
      <input
        autoFocus
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name…"
        aria-label="Search by name"
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
      />

      <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto">
        {results
          .filter((p) => p.id !== attach.personId)
          .map((p) => (
            <li key={p.id}>
              <button
                className="flex w-full items-baseline justify-between gap-2 px-1 py-1.5 text-left text-sm hover:bg-gray-50"
                onClick={() => setPickedId(p.id)}
              >
                <span>{primaryName(p)}</span>
                <span className="shrink-0 text-xs text-gray-400">
                  {lifeSpan(p, model)}
                </span>
              </button>
            </li>
          ))}
      </ul>

      {query.trim() && results.length === 0 && (
        <p className="text-xs text-gray-500">Nobody in this tree matches that.</p>
      )}

      <button
        className="rounded border border-dashed border-gray-300 px-3 py-1.5 text-left text-sm text-gray-700 hover:border-blue-400 hover:text-blue-700"
        onClick={() => {
          closeAttach();
          openAddPerson({ relation: attach.relation, personId: attach.personId });
        }}
      >
        + Create a new person{query.trim() ? ` “${query.trim()}”` : ''}
      </button>
    </Shell>
  );
}

function Shell({
  heading,
  onClose,
  children,
}: {
  heading: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-3">
          <h2 className="text-base font-bold text-gray-900">{heading}</h2>
          <button className="text-gray-400 hover:text-gray-700" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto p-3">{children}</div>
      </div>
    </div>
  );
}
