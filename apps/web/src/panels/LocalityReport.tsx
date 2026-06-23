import { useMemo } from 'react';
import { buildLocalityReport, localityReportToMarkdown } from '@genealogy/core';
import { useStore } from '../state/store.js';
import { primaryName } from '../graph/personDisplay.js';
import { triggerDownload } from '../export/download.js';

// The locality research report (handoff §4). Given a traced line (focal → a
// chosen ancestor) it pivots every fact place → year → person and flags the
// gaps. Reused by the Review tab and the SAR checklist hand-off.

const STATUS_STYLE: Record<string, string> = {
  sourced: 'bg-emerald-50 text-emerald-700',
  unsourced: 'bg-amber-100 text-amber-800',
  none: 'bg-red-100 text-red-800',
};

export function LocalityReport({ ancestorId }: { ancestorId: string }) {
  const model = useStore((s) => s.model);
  const graph = useStore((s) => s.graph);
  const focalPersonId = useStore((s) => s.focalPersonId);

  const report = useMemo(() => {
    if (!model || !graph || !focalPersonId) return null;
    return buildLocalityReport(model, graph, focalPersonId, ancestorId);
  }, [model, graph, focalPersonId, ancestorId]);

  if (!model || !graph || !focalPersonId) return null;
  if (!report) return null;

  const focalName = primaryName(model.persons.get(focalPersonId)!);
  const ancestorName = model.persons.get(ancestorId)
    ? primaryName(model.persons.get(ancestorId)!)
    : ancestorId;
  const title = `${focalName} → ${ancestorName}`;

  if (report.personIds.length === 0) {
    return (
      <p className="rounded border border-dashed border-gray-300 p-3 text-sm text-gray-500">
        No ancestral line found from {focalName} to {ancestorName}.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-500">
          {report.personIds.length} people on this line · {report.gapCount} research gap
          {report.gapCount === 1 ? '' : 's'}
          {report.truncated && ' · line capped (very deep)'}
        </p>
        <button
          className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          onClick={() =>
            triggerDownload(
              `locality-${ancestorName.replace(/\s+/g, '-')}.md`,
              localityReportToMarkdown(report, title),
              'text/markdown;charset=utf-8',
            )
          }
        >
          Export report
        </button>
      </div>

      <div className="space-y-2">
        {report.rows.map((row) => (
          <div
            key={row.placeKey || '(unknown)'}
            className={`rounded border p-2 ${
              row.isResearchTarget ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-800">{row.placeLabel}</div>
              {row.isResearchTarget && (
                <span className="rounded-full bg-red-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-800">
                  research target
                </span>
              )}
            </div>
            <ul className="mt-1 space-y-0.5">
              {row.facts.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-gray-700">
                  <span
                    className={`rounded px-1.5 py-0.5 font-medium ${STATUS_STYLE[f.status] ?? ''}`}
                  >
                    {f.status}
                  </span>
                  <span className="font-medium">{f.personName}</span>
                  <span className="text-gray-400">·</span>
                  <span>{f.eventType}</span>
                  <span className="text-gray-400">
                    {f.dateRaw ? ` · ${f.dateRaw}` : f.year !== undefined ? ` · ${f.year}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
