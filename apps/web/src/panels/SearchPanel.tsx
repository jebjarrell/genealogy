import { useState } from 'react';
import { useStore } from '../state/store.js';
import { lifeSpan, primaryName } from '../graph/personDisplay.js';

// Name search (TRD §10.3): case-insensitive substring across all name variants.
export function SearchPanel() {
  const [query, setQuery] = useState('');
  const model = useStore((s) => s.model);
  const search = useStore((s) => s.search);
  const setFocal = useStore((s) => s.setFocal);
  const selectPerson = useStore((s) => s.selectPerson);

  const results = query.trim() ? search(query) : [];

  return (
    <div className="p-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search people by name…"
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
      />
      {query.trim() && (
        <div className="mt-1 text-xs text-gray-400">{results.length} match(es)</div>
      )}
      <ul className="mt-1 max-h-64 space-y-0.5 overflow-y-auto">
        {results.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-gray-100"
          >
            <button
              className="truncate text-left text-sm text-blue-700 hover:underline"
              onClick={() => selectPerson(p.id)}
              title="Select"
            >
              {primaryName(p)}
              <span className="ml-1 text-xs text-gray-400">
                {model ? lifeSpan(p, model) : ''}
              </span>
            </button>
            <button
              className="shrink-0 rounded border border-gray-300 px-1 text-[11px] hover:bg-gray-200"
              onClick={() => setFocal(p.id)}
              title="Set as focal person"
            >
              focal
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
