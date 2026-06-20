import { useState } from 'react';
import { useStore } from '../state/store.js';

// Warnings surface (TRD §10.6): parse warnings and notices shown unobtrusively
// but discoverably, so the user knows when a file was partially read.
export function DataNotes() {
  const warnings = useStore((s) => s.warnings);
  const notice = useStore((s) => s.notice);
  const dismissWarnings = useStore((s) => s.dismissWarnings);
  const [open, setOpen] = useState(false);

  const warnCount = warnings.filter((w) => w.severity === 'warning').length;
  if (warnings.length === 0 && !notice) return null;

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-10 max-w-md">
      {notice && (
        <div className="mb-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white shadow">
          {notice}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 shadow">
          <button
            className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm"
            onClick={() => setOpen((o) => !o)}
          >
            <span className="font-semibold text-amber-800">
              Data notes — {warnCount} warning(s), {warnings.length - warnCount} info
            </span>
            <span className="text-amber-700">{open ? '▾' : '▸'}</span>
          </button>
          {open && (
            <div className="max-h-48 overflow-y-auto border-t border-amber-200 px-3 py-1">
              <ul className="space-y-0.5">
                {warnings.map((w, i) => (
                  <li key={i} className="text-xs text-gray-700">
                    <span
                      className={
                        w.severity === 'warning'
                          ? 'font-semibold text-amber-700'
                          : 'text-gray-400'
                      }
                    >
                      [{w.severity}]
                    </span>{' '}
                    {w.message}
                  </li>
                ))}
              </ul>
              <button
                className="my-1 text-xs text-blue-700 hover:underline"
                onClick={dismissWarnings}
              >
                dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
