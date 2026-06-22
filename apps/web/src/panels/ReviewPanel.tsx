import { writeGedcom, exportModelJson } from '@genealogy/core';
import { useStore } from '../state/store.js';
import { primaryName } from '../graph/personDisplay.js';

// "Review" tab: the edit history. Lists applied merges (newest first) with undo,
// and exports the current (merged) data — derived GEDCOM + lossless JSON.

function triggerDownload(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function baseName(fileName: string | null): string {
  if (!fileName) return 'genealogy';
  return fileName.replace(/\.[^.]+$/, '');
}

export function ReviewPanel() {
  const model = useStore((s) => s.model);
  const baseModel = useStore((s) => s.baseModel);
  const merges = useStore((s) => s.merges);
  const fileName = useStore((s) => s.fileName);
  const undoMerge = useStore((s) => s.undoMerge);
  const selectPerson = useStore((s) => s.selectPerson);

  if (!model || !baseModel) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        Load a file to review edits and export.
      </div>
    );
  }

  const nameOf = (id: string): string => {
    const p = baseModel.persons.get(id) ?? model.persons.get(id);
    return p ? primaryName(p) : id;
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-100 p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Review &amp; export</h2>
            <p className="text-sm text-gray-500">
              Merges are non-destructive — your original file is untouched and every
              merge is reversible.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              className="rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700"
              onClick={() =>
                triggerDownload(
                  `${baseName(fileName)}-merged.ged`,
                  writeGedcom(model),
                  'text/plain;charset=utf-8',
                )
              }
            >
              Export GEDCOM
            </button>
            <button
              className="rounded border border-gray-300 bg-white px-3 py-1 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              onClick={() =>
                triggerDownload(
                  `${baseName(fileName)}-merged.json`,
                  exportModelJson(model),
                  'application/json',
                )
              }
            >
              Export JSON
            </button>
          </div>
        </div>

        <p className="rounded bg-amber-50 p-2 text-[11px] text-amber-800">
          GEDCOM export is <strong>derived</strong>: it reflects the fields this app models
          (names, sex, events, family links, notes). Custom/unmodeled tags from the original
          file are not preserved. The JSON export is lossless for this app.
        </p>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">
            Merges ({merges.length})
          </h3>
          {merges.length === 0 ? (
            <p className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-500">
              No merges yet. Select two people in the graph, then choose{' '}
              <span className="font-medium">Merge</span> to combine duplicate records.
            </p>
          ) : (
            <ul className="space-y-2">
              {merges
                .map((op, index) => ({ op, index }))
                .reverse()
                .map(({ op, index }) => (
                  <li
                    key={`${op.at}-${index}`}
                    className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-white p-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-gray-800">
                        <button
                          className="font-medium text-blue-700 hover:underline"
                          onClick={() => selectPerson(op.keepId)}
                        >
                          {nameOf(op.keepId)}
                        </button>{' '}
                        <span className="text-gray-400">←</span> {nameOf(op.mergeId)}
                      </div>
                      <div className="text-[11px] text-gray-400">
                        {new Date(op.at).toLocaleString()}
                      </div>
                    </div>
                    <button
                      className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                      onClick={() => undoMerge(index)}
                    >
                      Undo
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
