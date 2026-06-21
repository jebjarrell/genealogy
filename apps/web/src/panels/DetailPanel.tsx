import { describeRelationship } from '@genealogy/core';
import { useStore } from '../state/store.js';
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

function RelationshipList({ title, ids }: { title: string; ids: string[] }) {
  const model = useStore((s) => s.model);
  const graph = useStore((s) => s.graph);
  const focalPersonId = useStore((s) => s.focalPersonId);
  const selectPerson = useStore((s) => s.selectPerson);
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
          return (
            <li key={id}>
              <button
                className="text-left text-sm text-blue-700 hover:underline"
                onClick={() => selectPerson(id)}
              >
                {primaryName(person)}
              </button>
              {rel && <span className="ml-1 text-xs text-gray-400">({rel})</span>}
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
        <h2 className="text-lg font-bold text-gray-900">{primaryName(person)}</h2>
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

      <ResearchLinks personId={person.id} />

      {events.length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Events
          </div>
          <ul className="mt-1 space-y-1">
            {events.map((e) => (
              <li key={e.id} className="text-sm text-gray-700">
                <span className="font-medium">{EVENT_LABELS[e.type] ?? e.type}</span>
                {e.date && <span> · {e.date.raw}</span>}
                {e.place && (
                  <span className="text-gray-500">
                    {' '}
                    · {e.place.raw} <PlaceResolveButton place={e.place} />
                  </span>
                )}
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

      <RelationshipList title="Parents" ids={parents} />
      <RelationshipList title="Spouses" ids={spouses} />
      <RelationshipList title="Children" ids={children} />

      {person.sources.length > 0 && (
        <div className="mt-2 text-[11px] text-gray-400">
          Citations: {person.sources.map((s) => s.page ?? s.raw).join('; ')}
        </div>
      )}
    </div>
  );
}
