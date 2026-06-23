import { useState } from 'react';
import { writeGedcom, exportModelJson, type EditOp } from '@genealogy/core';
import { useStore } from '../state/store.js';
import { primaryName } from '../graph/personDisplay.js';
import { triggerDownload } from '../export/download.js';
import { LocalityReport } from './LocalityReport.js';

// "Review" tab: the unified edit history (merges + manual add/edit) with undo and
// redo, data export (derived GEDCOM + lossless JSON — both now include manual
// edits, since they serialize the replayed model), and the locality research
// report export.

function baseName(fileName: string | null): string {
  if (!fileName) return 'genealogy';
  return fileName.replace(/\.[^.]+$/, '');
}

function describeOp(op: EditOp, nameOf: (id: string) => string): string {
  switch (op.kind) {
    case 'merge':
      return `Merged ${nameOf(op.keepId)} ← ${nameOf(op.mergeId)}`;
    case 'addPerson':
      return `Added person ${op.nameRaws[0]?.replace(/\//g, '') ?? '(unnamed)'}`;
    case 'editPerson':
      return `Edited ${nameOf(op.personId)}`;
    case 'addEvent':
      return `Added ${op.eventType} event`;
    case 'editEvent':
      return `Edited an event`;
    case 'linkRelationship':
      return `Linked ${op.relation === 'spouse' ? 'spouses' : 'parent–child'}`;
    case 'unlinkRelationship':
      return `Unlinked ${op.relation === 'spouse' ? 'spouses' : 'parent–child'}`;
  }
}

export function ReviewPanel() {
  const model = useStore((s) => s.model);
  const baseModel = useStore((s) => s.baseModel);
  const ops = useStore((s) => s.ops);
  const redoStack = useStore((s) => s.redoStack);
  const fileName = useStore((s) => s.fileName);
  const undoOp = useStore((s) => s.undoOp);
  const redo = useStore((s) => s.redo);
  const selectPerson = useStore((s) => s.selectPerson);
  const collapsePoints = useStore((s) => s.collapsePoints);
  const focalPersonId = useStore((s) => s.focalPersonId);
  const [reportAncestor, setReportAncestor] = useState<string>('');

  if (!model || !baseModel) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        Load a file to review edits and export.
      </div>
    );
  }

  const nameOf = (id: string): string => {
    const p = model.persons.get(id) ?? baseModel.persons.get(id);
    return p ? primaryName(p) : id;
  };

  // Candidate ancestors for a locality report: collapse points + direct ancestors.
  const ancestorChoices = collapsePoints.map((c) => c.ancestorId);

  return (
    <div className="h-full overflow-y-auto bg-gray-100 p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Review &amp; export</h2>
            <p className="text-sm text-gray-500">
              Every edit is non-destructive — your original file is untouched and all
              edits are reversible.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              className="rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700"
              onClick={() =>
                triggerDownload(
                  `${baseName(fileName)}-edited.ged`,
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
                  `${baseName(fileName)}-edited.json`,
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
          GEDCOM export is <strong>derived</strong> (modeled fields only) and now includes
          your manual additions and edits. The JSON export is lossless for this app.
        </p>

        {/* ---- Edit history ---- */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">
              Edit history ({ops.length})
            </h3>
            <button
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              disabled={redoStack.length === 0}
              onClick={() => redo()}
            >
              Redo
            </button>
          </div>
          {ops.length === 0 ? (
            <p className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-500">
              No edits yet. Merge duplicates, or add/edit people from the graph and detail
              panel — everything appears here and can be undone.
            </p>
          ) : (
            <ul className="space-y-2">
              {ops
                .map((op, index) => ({ op, index }))
                .reverse()
                .map(({ op, index }) => (
                  <li
                    key={`${op.at}-${index}`}
                    className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-white p-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-gray-800">
                        {op.kind === 'merge' ? (
                          <>
                            <button
                              className="font-medium text-blue-700 hover:underline"
                              onClick={() => selectPerson(op.keepId)}
                            >
                              {nameOf(op.keepId)}
                            </button>{' '}
                            <span className="text-gray-400">←</span> {nameOf(op.mergeId)}
                          </>
                        ) : (
                          describeOp(op, nameOf)
                        )}
                      </div>
                      <div className="text-[11px] text-gray-400">
                        {new Date(op.at).toLocaleString()}
                      </div>
                    </div>
                    <button
                      className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                      onClick={() => undoOp(index)}
                    >
                      Undo
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>

        {/* ---- Locality research report ---- */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">
            Locality research report
          </h3>
          {!focalPersonId ? (
            <p className="text-sm text-gray-500">Choose a focal person first.</p>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2">
                <label className="text-xs text-gray-500">Trace the line to:</label>
                <select
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                  value={reportAncestor}
                  onChange={(e) => setReportAncestor(e.target.value)}
                >
                  <option value="">Select an ancestor…</option>
                  {ancestorChoices.map((id) => (
                    <option key={id} value={id}>
                      {nameOf(id)} {collapsePoints.some((c) => c.ancestorId === id) ? '(collapse point)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              {reportAncestor ? (
                <LocalityReport ancestorId={reportAncestor} />
              ) : (
                <p className="text-xs text-gray-500">
                  Pick an ancestor to see where the sourcing gaps are along that line.
                  Collapse-point ancestors are listed; the report consumes the enumerated
                  paths, so braided lines are not double-counted.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
