import { useRef, useState } from 'react';
import { useStore } from '../state/store.js';
import { readFileAsBytes } from './loadGedcom.js';
// Bundled sample so the app is verifiable without hunting for a .ged file.
import sampleGed from '../../../../packages/core/tests/fixtures/pedigree-collapse.ged?raw';

const SAMPLE_NAME = 'pedigree-collapse-sample.ged';

export function UploadButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const importGedcom = useStore((s) => s.importGedcom);
  const [busy, setBusy] = useState(false);

  async function run(bytes: Uint8Array, fileName: string) {
    setBusy(true);
    try {
      await importGedcom(bytes, fileName);
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
          if (file) void readFileAsBytes(file).then((bytes) => run(bytes, file.name));
          // Allow re-picking the same file (change does not fire otherwise).
          e.target.value = '';
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
        disabled={busy}
        onClick={() => void run(new TextEncoder().encode(sampleGed), SAMPLE_NAME)}
      >
        Load sample
      </button>
    </div>
  );
}
