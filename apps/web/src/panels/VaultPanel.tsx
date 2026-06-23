import { useRef } from 'react';
import { useStore } from '../state/store.js';

// The document vault surface (handoff §7). Shows every stored document, its
// content hash, and what it's linked to. The vault is global (shared across
// projects) and deduped by content hash.

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function VaultPanel() {
  const workspace = useStore((s) => s.workspace);
  const vaultDocs = useStore((s) => s.vaultDocs);
  const addVaultDocument = useStore((s) => s.addVaultDocument);
  const connectWorkspace = useStore((s) => s.connectWorkspace);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="h-full overflow-y-auto bg-gray-100 p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Document vault</h2>
            <p className="text-sm text-gray-500">
              PDF, JPG, and PNG documents, deduplicated by content. Shared across all
              projects; link them to SAR checklist items as evidence.
            </p>
          </div>
          {workspace && (
            <>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void addVaultDocument(file);
                  e.target.value = '';
                }}
              />
              <button
                className="shrink-0 rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700"
                onClick={() => inputRef.current?.click()}
              >
                Add document
              </button>
            </>
          )}
        </div>

        {!workspace ? (
          <div className="rounded border border-dashed border-gray-300 p-6 text-center">
            <p className="text-sm text-gray-600">
              Connect a workspace folder to store documents in a real folder you control.
            </p>
            <button
              className="mt-2 rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700"
              onClick={() => void connectWorkspace()}
            >
              Connect workspace
            </button>
          </div>
        ) : vaultDocs.length === 0 ? (
          <p className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-500">
            No documents yet. Add a birth/marriage/death certificate, will, census page, or
            pension record.
          </p>
        ) : (
          <ul className="space-y-2">
            {vaultDocs.map((d) => (
              <li key={d.docId} className="rounded border border-gray-200 bg-white p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium text-gray-800">
                    {d.originalName}
                  </span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {d.mimetype.split('/')[1]?.toUpperCase()} · {formatBytes(d.size)}
                  </span>
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-gray-400">
                  {d.hash.slice(0, 16)}…
                </div>
                <div className="text-[11px] text-gray-500">
                  {d.citationLinks.length === 0
                    ? 'Not yet linked to any checklist item'
                    : `Linked to ${d.citationLinks.length} checklist item(s)`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
