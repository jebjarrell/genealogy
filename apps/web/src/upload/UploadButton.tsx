import { useRef, useState } from 'react';
import { parseGedcom } from '@genealogy/core';
import { useStore } from '../state/store.js';
import { readFileAsBytes } from './loadGedcom.js';
// Bundled sample so the app is verifiable without hunting for a .ged file.
import sampleGed from '../../../../packages/core/tests/fixtures/pedigree-collapse.ged?raw';

export function UploadButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const loadModel = useStore((s) => s.loadModel);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    try {
      const bytes = await readFileAsBytes(file);
      loadModel(parseGedcom(bytes), file.name);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".ged,.gedcom,text/plain"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
        }}
      />
      <button
        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Loading…' : 'Load GEDCOM'}
      </button>
      <button
        className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100"
        onClick={() =>
          loadModel(parseGedcom(sampleGed), 'pedigree-collapse.ged (sample)')
        }
      >
        Load sample
      </button>
    </div>
  );
}
