import { useEffect, useState } from 'react';
import { mergePersons } from '@genealogy/core';
import { useStore } from '../state/store.js';
import { primaryName, lifeSpan } from '../graph/personDisplay.js';

// Confirm a merge of the two selected people. Auto-merge with a before→after
// preview (owner's choice). You pick which record survives ("keep"); the other
// is folded in. Reuses the FocalPicker overlay styling.

function dataRichness(personId: string): number {
  const model = useStore.getState().model;
  const p = model?.persons.get(personId);
  if (!p) return 0;
  return p.names.length + p.eventIds.length + p.sources.length + (p.notes?.length ?? 0);
}

export function MergeConfirm() {
  const mergeOpen = useStore((s) => s.mergeOpen);
  const selectedIds = useStore((s) => s.selectedIds);
  const model = useStore((s) => s.model);
  const closeMerge = useStore((s) => s.closeMerge);
  const mergePeople = useStore((s) => s.mergePeople);

  // Default the survivor to the richer record; let the user swap.
  const [keepFirst, setKeepFirst] = useState(true);
  useEffect(() => {
    if (mergeOpen && selectedIds.length === 2) {
      setKeepFirst(dataRichness(selectedIds[0]!) >= dataRichness(selectedIds[1]!));
    }
  }, [mergeOpen, selectedIds]);

  if (!mergeOpen || !model || selectedIds.length !== 2) return null;
  const [a, b] = selectedIds as [string, string];
  const keepId = keepFirst ? a : b;
  const mergeId = keepFirst ? b : a;
  const keep = model.persons.get(keepId);
  const merge = model.persons.get(mergeId);
  if (!keep || !merge) return null;

  // Preview the surviving record without committing.
  const preview = mergePersons(model, keepId, mergeId).persons.get(keepId)!;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="border-b border-gray-200 p-3">
          <h2 className="text-base font-bold text-gray-900">Merge two people</h2>
          <p className="text-xs text-gray-500">
            One record survives; the other is folded into it. Links move over and
            duplicates are removed. You can undo this from the Review tab.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-2">
            {[a, b].map((id) => {
              const p = model.persons.get(id)!;
              const isKeep = id === keepId;
              return (
                <button
                  key={id}
                  onClick={() => setKeepFirst(id === a)}
                  className={`rounded border p-2 text-left text-sm ${
                    isKeep
                      ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-400'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="font-semibold text-gray-900">{primaryName(p)}</div>
                  <div className="text-xs text-gray-500">{lifeSpan(p, model) || '—'}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-gray-400">
                    {isKeep ? 'Keep (survivor)' : 'Merge in'}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-3 rounded-md bg-gray-50 p-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Result
            </div>
            <div className="mt-1 font-semibold text-gray-900">{primaryName(preview)}</div>
            {preview.names.length > 1 && (
              <div className="text-xs text-gray-500">
                also known as {preview.names.slice(1).map((n) => n.full || n.raw).join('; ')}
              </div>
            )}
            <ul className="mt-1 text-xs text-gray-600">
              <li>{preview.names.length} name(s)</li>
              <li>{preview.eventIds.length} event(s)</li>
              <li>{preview.familyIdsAsSpouse.length} spouse-family link(s)</li>
              <li>{preview.sources.length} source(s)</li>
            </ul>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 p-3">
          <button
            className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
            onClick={() => closeMerge()}
          >
            Cancel
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700"
            onClick={() => mergePeople(keepId, mergeId)}
          >
            Merge
          </button>
        </div>
      </div>
    </div>
  );
}
