import { useMemo, useState } from 'react';
import { pickDefaultFocalPerson } from '@genealogy/core';
import { useStore } from '../state/store.js';
import { lifeSpan, primaryName } from '../graph/personDisplay.js';

// On load, ask who "you" are (the focal person) instead of guessing (TRD §13
// alternative). Pre-suggests the heuristic default; the choice is remembered per
// file and changeable later via the header.
export function FocalPicker() {
  const open = useStore((s) => s.focalPickerOpen);
  const model = useStore((s) => s.model);
  const graph = useStore((s) => s.graph);
  const focalPersonId = useStore((s) => s.focalPersonId);
  const setFocal = useStore((s) => s.setFocal);
  const closeFocalPicker = useStore((s) => s.closeFocalPicker);
  const search = useStore((s) => s.search);
  const [query, setQuery] = useState('');

  const suggested = useMemo(
    () => (model && graph ? pickDefaultFocalPerson(graph, model) : ''),
    [model, graph],
  );

  if (!open || !model) return null;
  const results = query.trim()
    ? search(query)
    : suggested && model.persons.has(suggested)
      ? [model.persons.get(suggested)!]
      : [...model.persons.values()].slice(0, 25);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-bold text-gray-900">Who are you?</h2>
          <p className="text-xs text-gray-500">
            Pick the person to center the tree on. You can change this anytime.
          </p>
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.map((p) => (
            <li key={p.id}>
              <button
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-blue-50"
                onClick={() => setFocal(p.id)}
              >
                <span className="truncate text-sm font-medium text-gray-800">
                  {primaryName(p)}
                  {p.id === suggested && !query.trim() && (
                    <span className="ml-2 rounded bg-blue-100 px-1 text-[10px] text-blue-700">
                      suggested
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-gray-400">
                  {lifeSpan(p, model)}
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-2 py-4 text-center text-sm text-gray-400">No matches.</li>
          )}
        </ul>
        {focalPersonId && (
          <div className="border-t border-gray-200 px-4 py-2 text-right">
            <button
              className="text-xs text-gray-500 hover:underline"
              onClick={closeFocalPicker}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
