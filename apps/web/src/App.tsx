import { useState } from 'react';
import { useStore } from './state/store.js';
import { UploadButton } from './upload/UploadButton.js';
import { GraphCanvas } from './graph/GraphCanvas.js';
import { DetailPanel } from './panels/DetailPanel.js';
import { SearchPanel } from './panels/SearchPanel.js';
import { CollapseReport } from './panels/CollapseReport.js';
import { PathsPanel } from './panels/PathsPanel.js';
import { DataNotes } from './panels/DataNotes.js';

type LeftTab = 'search' | 'collapse';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-gray-200">
      <div className="bg-gray-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-gray-500">
        {title}
      </div>
      {children}
    </div>
  );
}

export function App() {
  const model = useStore((s) => s.model);
  const fileName = useStore((s) => s.fileName);
  const focalName = useStore((s) => {
    if (!s.model || !s.focalPersonId) return null;
    return s.model.persons.get(s.focalPersonId)?.names[0]?.full ?? s.focalPersonId;
  });
  const [leftTab, setLeftTab] = useState<LeftTab>('collapse');

  return (
    <div className="flex h-full flex-col bg-gray-100 text-gray-900">
      <header className="flex items-center justify-between border-b border-gray-300 bg-white px-4 py-2">
        <div>
          <h1 className="text-base font-bold">Genealogy Knowledge Graph Viewer</h1>
          {fileName && (
            <div className="text-xs text-gray-500">
              {fileName}
              {focalName && <> · focal: {focalName}</>}
            </div>
          )}
        </div>
        <UploadButton />
      </header>

      {!model ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="max-w-md text-gray-600">
            Load a GEDCOM (<code>.ged</code>) file to explore your family tree as an
            interactive, ego-centric graph — with pedigree-collapse detection. Parsing
            happens entirely in your browser; the file never leaves your machine.
          </p>
          <UploadButton />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-72 flex-col overflow-y-auto border-r border-gray-300 bg-white">
            <div className="flex border-b border-gray-200 text-sm">
              <button
                className={`flex-1 px-2 py-1.5 ${leftTab === 'collapse' ? 'bg-amber-100 font-semibold' : 'hover:bg-gray-50'}`}
                onClick={() => setLeftTab('collapse')}
              >
                Pedigree collapse
              </button>
              <button
                className={`flex-1 px-2 py-1.5 ${leftTab === 'search' ? 'bg-blue-100 font-semibold' : 'hover:bg-gray-50'}`}
                onClick={() => setLeftTab('search')}
              >
                Search
              </button>
            </div>
            {leftTab === 'collapse' ? <CollapseReport /> : <SearchPanel />}
          </aside>

          <main className="relative min-w-0 flex-1">
            <GraphCanvas />
            <DataNotes />
          </main>

          <aside className="flex w-80 flex-col overflow-y-auto border-l border-gray-300 bg-white">
            <Section title="Detail">
              <DetailPanel />
            </Section>
            <Section title="Relationship">
              <PathsPanel />
            </Section>
          </aside>
        </div>
      )}
    </div>
  );
}
