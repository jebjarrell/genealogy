import { useState } from 'react';
import {
  coParentsOf,
  describeRelationship,
  findParentChildFamily,
  personSketch,
  militaryServiceRecords,
} from '@genealogy/core';
import { useStore } from '../state/store.js';
import { useEditorStore } from '../state/editorStore.js';
import { allEventsOf, primaryName } from '../graph/personDisplay.js';
import { PlaceResolveButton } from './PlaceResolveButton.js';
import {
  researchFacts,
  ancestrySearchUrl,
  familySearchRecordUrl,
  darSearchUrl,
} from '../research/links.js';

const EVENT_LABELS: Record<string, string> = {
  birth: 'Born',
  death: 'Died',
  marriage: 'Married',
  burial: 'Buried',
  baptism: 'Baptized',
  census: 'Census',
  residence: 'Resided',
  immigration: 'Immigrated',
  emigration: 'Emigrated',
  military: 'Military',
  occupation: 'Occupation',
  other: 'Event',
};

/**
 * Which side of a parent-child link this list shows, so a row knows both ends of
 * the link it would sever. Omitted for lists (spouses) that cannot be detached.
 */
type Detach =
  | { direction: 'parent'; childId: string }
  | { direction: 'child'; parentId: string };

function RelationshipList({
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
  // Only one row is armed at a time, so a stray click cannot confirm a
  // different row than the one the user was looking at.
  const [armed, setArmed] = useState<string | null>(null);
  if (!model || ids.length === 0) return null;
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
          // Resolve both ends of the link this row represents, then the FAM that
          // carries it. GEDCOM has no direct parent-child record to remove.
          const parentId = detach?.direction === 'parent' ? id : detach?.parentId;
          const childId = detach?.direction === 'child' ? id : detach?.childId;
          const familyId =
            graph && parentId && childId
              ? findParentChildFamily(graph, parentId, childId)
              : null;
          // Detaching a child removes the whole couple, so name the others.
          const alsoRemoved =
            familyId && parentId
              ? coParentsOf(model, familyId, parentId)
                  .map((pid) => model.persons.get(pid))
                  .filter((p): p is NonNullable<typeof p> => p !== undefined)
                  .map(primaryName)
              : [];

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
              {familyId && (
                <span className="shrink-0">
                  {armed === id ? (
                    <span className="flex items-center gap-1">
                      <button
                        className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold text-white hover:bg-red-700"
                        title={
                          alsoRemoved.length > 0
                            ? `Also removes ${alsoRemoved.join(' and ')}, recorded as one couple`
                            : undefined
                        }
                        onClick={() => {
                          unlinkRelationship(familyId, 'parent-child', { childId });
                          setArmed(null);
                        }}
                      >
                        Remove
                      </button>
                      <button
                        className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] hover:bg-gray-50"
                        onClick={() => setArmed(null)}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 hover:border-red-300 hover:text-red-600"
                      title={`Remove this ${detach?.direction === 'parent' ? 'parent' : 'child'} link`}
                      onClick={() => setArmed(id)}
                    >
                      Remove…
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
        {armed !== null &&
          (() => {
            // The consequence is stated once, below the list, where there is room
            // for a full sentence rather than a tooltip.
            const armedParentId =
              detach?.direction === 'parent' ? armed : detach?.parentId;
            const armedChildId =
              detach?.direction === 'child' ? armed : detach?.childId;
            const famId =
              graph && armedParentId && armedChildId
                ? findParentChildFamily(graph, armedParentId, armedChildId)
                : null;
            const others =
              famId && armedParentId
                ? coParentsOf(model, famId, armedParentId)
                    .map((pid) => model.persons.get(pid))
                    .filter((p): p is NonNullable<typeof p> => p !== undefined)
                    .map(primaryName)
                : [];
            const parentName = armedParentId
              ? (model.persons.get(armedParentId)?.names[0]?.full ?? armedParentId)
              : '';
            const childName = armedChildId
              ? (model.persons.get(armedChildId)?.names[0]?.full ?? armedChildId)
              : '';
            return (
              <li className="mt-1 rounded bg-amber-50 p-2 text-[11px] leading-snug text-amber-900">
                Remove <span className="font-semibold">{parentName}</span> as a parent
                of <span className="font-semibold">{childName}</span>?
                {others.length > 0 && (
                  <>
                    {' '}
                    This also removes{' '}
                    <span className="font-semibold">{others.join(' and ')}</span>,
                    because GEDCOM records them as one couple.
                  </>
                )}{' '}
                You can undo it from the Review tab.
              </li>
            );
          })()}
      </ul>
    </div>
  );
}

// FamilySearch-style bio sketch shown at the top of the profile. The full event,
// relationship, and source lists remain below it (owner's choice).
function BioSketch({ personId }: { personId: string }) {
  const model = useStore((s) => s.model);
  const graph = useStore((s) => s.graph);
  const selectPerson = useStore((s) => s.selectPerson);
  if (!model || !graph) return null;
  const sketch = personSketch(model, graph, personId);
  if (!sketch) return null;

  const eventLine = (e?: { dateRaw?: string; place?: string }) =>
    e ? [e.dateRaw, e.place].filter(Boolean).join(' · ') || '—' : '—';

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm text-gray-700">{children}</dd>
    </div>
  );

  return (
    <dl className="space-y-1 rounded-md bg-gray-50 p-2">
      <Row label="Born">{eventLine(sketch.birth)}</Row>
      <Row label="Died">
        {eventLine(sketch.death)}
        {sketch.ageAtDeath !== undefined && (
          <span className="text-gray-400"> · age {sketch.ageAtDeath}</span>
        )}
      </Row>
      <Row label="Spouse">
        {sketch.spouses.length === 0
          ? '—'
          : sketch.spouses.map((sp, i) => (
              <span key={sp.id}>
                {i > 0 && ', '}
                <button
                  className="text-blue-700 hover:underline"
                  onClick={() => selectPerson(sp.id)}
                >
                  {sp.name}
                </button>
              </span>
            ))}
      </Row>
      <Row label="Children">{sketch.childrenCount}</Row>
      <Row label="Military">
        {sketch.military.served ? (
          <span className="font-medium text-emerald-700">
            Yes
            {sketch.military.wars.length > 0 && ` · ${sketch.military.wars.join(', ')}`}
          </span>
        ) : (
          'No'
        )}
      </Row>
    </dl>
  );
}

// Standardized military service (#10): branch / unit / rank / war / dates pulled
// from the person's military events, raw description preserved beneath.
function MilitarySection({ personId }: { personId: string }) {
  const model = useStore((s) => s.model);
  if (!model) return null;
  const records = militaryServiceRecords(model, personId);
  if (records.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
        Military service
      </div>
      <ul className="mt-1 space-y-1">
        {records.map((r, i) => {
          const headline = [r.rank, r.unit].filter(Boolean).join(', ');
          return (
            <li key={r.eventId ?? i} className="text-sm text-gray-700">
              <span className="font-medium">{headline || r.war || 'Military'}</span>
              {r.branch && <span> · {r.branch}</span>}
              {r.war && headline && <span className="text-gray-500"> — {r.war}</span>}
              {r.serviceDates?.raw && (
                <span className="text-gray-400"> ({r.serviceDates.raw})</span>
              )}
              {r.raw && <div className="text-[11px] text-gray-400">{r.raw}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Deep-links into external sites (Ancestry, FamilySearch, DAR), pre-filled from
// the person's known facts. No API — each opens a search in a new tab.
function ResearchLinks({ personId }: { personId: string }) {
  const model = useStore((s) => s.model);
  const graph = useStore((s) => s.graph);
  if (!model || !graph) return null;
  const facts = researchFacts(model, graph, personId);
  if (!facts || (!facts.given && !facts.surname && !facts.fullName)) return null;

  const links: { label: string; href: string; title: string }[] = [
    {
      label: 'Ancestry',
      href: ancestrySearchUrl(facts),
      title: 'Search Ancestry.com with this person’s details',
    },
    {
      label: 'FamilySearch',
      href: familySearchRecordUrl(facts),
      title: 'Search FamilySearch records with this person’s details',
    },
    {
      label: 'DAR',
      href: darSearchUrl(),
      title: 'Open the DAR Genealogical Research System ancestor search',
    },
  ];

  return (
    <div className="mt-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
        Search on
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {links.map((l) => (
          <a
            key={l.label}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            title={l.title}
            className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
          >
            {l.label} ↗
          </a>
        ))}
      </div>
    </div>
  );
}

export function DetailPanel() {
  const model = useStore((s) => s.model);
  const graph = useStore((s) => s.graph);
  const detailPersonId = useStore((s) => s.detailPersonId);
  const focalPersonId = useStore((s) => s.focalPersonId);
  const setFocal = useStore((s) => s.setFocal);
  const expand = useStore((s) => s.expand);
  const openEditPerson = useEditorStore((s) => s.openEditPerson);
  const openAddPerson = useEditorStore((s) => s.openAddPerson);
  const openAddEvent = useEditorStore((s) => s.openAddEvent);
  const openEditEvent = useEditorStore((s) => s.openEditEvent);

  if (!model || !graph || !detailPersonId) {
    return <p className="p-3 text-sm text-gray-400">Select a person to see details.</p>;
  }
  const person = model.persons.get(detailPersonId);
  if (!person) return null;

  const events = allEventsOf(person, model);
  const parents = graph.parentsOf.get(person.id) ?? [];
  const children = graph.childrenOf.get(person.id) ?? [];
  const spouses = graph.spousesOf.get(person.id) ?? [];

  return (
    <div className="space-y-2 p-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
          {primaryName(person)}
          {person.userSupplied && (
            <span
              className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700"
              title="Added or edited by you — not from the original GEDCOM"
            >
              user-supplied
            </span>
          )}
        </h2>
        {person.names.length > 1 && (
          <div className="text-xs text-gray-500">
            also:{' '}
            {person.names
              .slice(1)
              .map((n) => n.full || n.raw)
              .join('; ')}
          </div>
        )}
        <div className="mt-0.5 text-xs text-gray-400">
          {person.externalId}
          {focalPersonId && focalPersonId !== person.id && (
            <>
              {' '}
              · {describeRelationship(graph, model, focalPersonId, person.id)} of focal
            </>
          )}
        </div>
      </div>

      <BioSketch personId={person.id} />

      <div className="flex flex-wrap gap-1">
        <button
          className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700"
          onClick={() => setFocal(person.id)}
        >
          Set as focal
        </button>
        <button
          className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100"
          onClick={() => expand(person.id, 'ancestors')}
        >
          + Ancestors
        </button>
        <button
          className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100"
          onClick={() => expand(person.id, 'descendants')}
        >
          + Descendants
        </button>
      </div>

      <div className="flex flex-wrap gap-1 border-t border-gray-100 pt-2">
        <button
          className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
          onClick={() => openEditPerson(person.id)}
        >
          ✎ Edit
        </button>
        <button
          className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
          onClick={() => openAddEvent(person.id)}
        >
          + Event
        </button>
        <button
          className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
          onClick={() => openAddPerson({ relation: 'parent', personId: person.id })}
        >
          + Parent
        </button>
        <button
          className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
          onClick={() => openAddPerson({ relation: 'child', personId: person.id })}
        >
          + Child
        </button>
        <button
          className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
          onClick={() => openAddPerson({ relation: 'spouse', personId: person.id })}
        >
          + Spouse
        </button>
      </div>

      <ResearchLinks personId={person.id} />

      <MilitarySection personId={person.id} />

      {events.length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Events
          </div>
          <ul className="mt-1 space-y-1">
            {events.map((e) => (
              <li key={e.id} className="group text-sm text-gray-700">
                <span className="font-medium">{EVENT_LABELS[e.type] ?? e.type}</span>
                {e.date && <span> · {e.date.raw}</span>}
                {e.place && (
                  <span className="text-gray-500">
                    {' '}
                    · {e.place.raw} <PlaceResolveButton place={e.place} />
                  </span>
                )}
                {e.userSupplied && (
                  <span className="ml-1 text-[10px] font-semibold uppercase text-violet-600">
                    edited
                  </span>
                )}
                <button
                  className="ml-1 text-[11px] text-violet-600 opacity-0 hover:underline group-hover:opacity-100"
                  onClick={() => openEditEvent(person.id, e.id)}
                  title="Edit this event"
                >
                  ✎
                </button>
                {e.sources.length > 0 && (
                  <div className="text-[11px] text-gray-400">
                    source: {e.sources.map((s) => s.page ?? s.raw).join('; ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <RelationshipList
        title="Parents"
        ids={parents}
        detach={{ direction: 'parent', childId: person.id }}
      />
      <RelationshipList title="Spouses" ids={spouses} />
      <RelationshipList
        title="Children"
        ids={children}
        detach={{ direction: 'child', parentId: person.id }}
      />

      {person.sources.length > 0 && (
        <div className="mt-2 text-[11px] text-gray-400">
          Citations: {person.sources.map((s) => s.page ?? s.raw).join('; ')}
        </div>
      )}
    </div>
  );
}
