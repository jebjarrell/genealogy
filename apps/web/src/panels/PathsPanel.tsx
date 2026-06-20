import { describeRelationship } from '@genealogy/core';
import { useStore } from '../state/store.js';
import { primaryName } from '../graph/personDisplay.js';

// Relationship / path-finding panel (TRD §10.3, §10.5): select two people, see
// every distinct relationship path between them, each described in relationship
// terms, with all paths highlighted on the graph.
export function PathsPanel() {
  const model = useStore((s) => s.model);
  const graph = useStore((s) => s.graph);
  const selectedIds = useStore((s) => s.selectedIds);
  const highlight = useStore((s) => s.highlight);
  const showRelationship = useStore((s) => s.showRelationship);
  const clearHighlight = useStore((s) => s.clearHighlight);
  const clearSelection = useStore((s) => s.clearSelection);

  if (!model || !graph) return null;
  const nameOf = (id: string) => {
    const p = model.persons.get(id);
    return p ? primaryName(p) : id;
  };

  return (
    <div className="space-y-2 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
        Relationship paths
      </div>

      <div className="text-sm text-gray-700">
        {selectedIds.length === 0 && (
          <span className="text-gray-400">Click two people to compare them.</span>
        )}
        {selectedIds.map((id, i) => (
          <span key={id}>
            {i > 0 && <span className="text-gray-400"> ↔ </span>}
            <span className="font-medium">{nameOf(id)}</span>
          </span>
        ))}
      </div>

      {selectedIds.length === 2 && (
        <div className="text-sm text-gray-600">
          {nameOf(selectedIds[1]!)} is the{' '}
          <span className="font-semibold">
            {describeRelationship(graph, model, selectedIds[0]!, selectedIds[1]!)}
          </span>{' '}
          of {nameOf(selectedIds[0]!)}.
          <button
            className="ml-2 rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-red-700"
            onClick={() => showRelationship(selectedIds[0]!, selectedIds[1]!)}
          >
            Show all paths
          </button>
        </div>
      )}

      {highlight && (
        <div className="rounded border border-red-200 bg-red-50 p-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">
              {highlight.paths.length} path(s): {nameOf(highlight.fromId)} →{' '}
              {nameOf(highlight.toId)}
            </span>
            <button
              className="text-xs text-blue-700 hover:underline"
              onClick={() => {
                clearHighlight();
                clearSelection();
              }}
            >
              clear
            </button>
          </div>
          {highlight.truncated && (
            <div className="text-[11px] text-amber-700">
              results truncated at the enumeration cap
            </div>
          )}
          <ol className="mt-1 space-y-1">
            {highlight.paths.map((path, i) => (
              <li key={i} className="text-xs text-gray-600">
                <span className="font-semibold text-gray-700">#{i + 1}</span> (
                {path.length} step{path.length === 1 ? '' : 's'}):{' '}
                {path.steps.map((s) => nameOf(s.personId)).join(' → ')}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
