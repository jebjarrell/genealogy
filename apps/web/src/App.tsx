import { useState } from 'react';
import { useStore } from './state/store.js';
import { UploadButton } from './upload/UploadButton.js';
import { GraphCanvas } from './graph/GraphCanvas.js';
import { DetailPanel } from './panels/DetailPanel.js';
import { SearchPanel } from './panels/SearchPanel.js';
import { CollapseReport } from './panels/CollapseReport.js';
import { PathsPanel } from './panels/PathsPanel.js';
import { DataNotes } from './panels/DataNotes.js';
import { ViewControls } from './panels/ViewControls.js';
import { FocalPicker } from './panels/FocalPicker.js';
import { MapView } from './map/MapView.js';

type LeftTab = 'search' | 'collapse';
type MainView = 'graph' | 'map';

/** Boolean UI state persisted to localStorage so panel layout survives reloads. */
function usePersisted(key: string, initial: boolean) {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : stored === '1';
    } catch {
      return initial;
    }
  });
  const set = (next: boolean) => {
    setValue(next);
    try {
      localStorage.setItem(key, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  return [value, set] as const;
}

function CollapsibleSection({
  title,
  storageKey,
  children,
}: {
  title: string;
  storageKey: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = usePersisted(storageKey, true);
  return (
    <div className="border-b border-gray-200">
      <button
        className="flex w-full items-center justify-between bg-gray-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-gray-500 hover:bg-gray-100"
        onClick={() => setOpen(!open)}
      >
        {title}
        <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && children}
    </div>
  );
}

export function App() {
  const model = useStore((s) => s.model);
  const fileName = useStore((s) => s.fileName);
  const openFocalPicker = useStore((s) => s.openFocalPicker);
  const focalName = useStore((s) => {
    if (!s.model || !s.focalPersonId) return null;
    return s.model.persons.get(s.focalPersonId)?.names[0]?.full ?? s.focalPersonId;
  });
  const [leftTab, setLeftTab] = useState<LeftTab>('collapse');
  const [leftOpen, setLeftOpen] = usePersisted('ui:leftOpen', true);
  const [rightOpen, setRightOpen] = usePersisted('ui:rightOpen', true);
  const [mainView, setMainView] = useState<MainView>('graph');

  return (
    <div className="flex h-full flex-col bg-gray-100 text-gray-900">
      <header className="flex items-center justify-between border-b border-gray-300 bg-white px-4 py-2">
        <div>
          <h1 className="text-base font-bold">Genealogy Knowledge Graph Viewer</h1>
          {fileName && (
            <div className="text-xs text-gray-500">
              {fileName}
              {focalName && (
                <>
                  {' · focal: '}
                  <button
                    className="font-medium text-blue-700 hover:underline"
                    onClick={openFocalPicker}
                    title="Change focal person"
                  >
                    {focalName} ✎
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {model && (
            <div className="flex overflow-hidden rounded border border-gray-300 text-sm">
              <button
                className={`px-3 py-1 ${mainView === 'graph' ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-100'}`}
                onClick={() => setMainView('graph')}
              >
                Graph
              </button>
              <button
                className={`px-3 py-1 ${mainView === 'map' ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-100'}`}
                onClick={() => setMainView('map')}
                title="Migration map for an ancestral line"
              >
                Map
              </button>
            </div>
          )}
          <UploadButton />
        </div>
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
          {leftOpen ? (
            <aside className="flex w-72 flex-col overflow-y-auto border-r border-gray-300 bg-white">
              <div className="flex items-stretch border-b border-gray-200 text-sm">
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
                <button
                  className="px-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  title="Collapse panel"
                  onClick={() => setLeftOpen(false)}
                >
                  ⟨
                </button>
              </div>
              {leftTab === 'collapse' ? <CollapseReport /> : <SearchPanel />}
            </aside>
          ) : (
            <button
              className="border-r border-gray-300 bg-white px-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              title="Expand left panel"
              onClick={() => setLeftOpen(true)}
            >
              ⟩
            </button>
          )}

          <main className="relative min-w-0 flex-1">
            {mainView === 'graph' ? (
              <>
                <ViewControls />
                <GraphCanvas />
              </>
            ) : (
              <MapView />
            )}
            <DataNotes />
          </main>

          {rightOpen ? (
            <aside className="flex w-80 flex-col overflow-y-auto border-l border-gray-300 bg-white">
              <button
                className="flex items-center justify-between border-b border-gray-200 px-3 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                title="Collapse panel"
                onClick={() => setRightOpen(false)}
              >
                <span className="font-bold uppercase tracking-wide">Panels</span>
                <span>⟩</span>
              </button>
              <CollapsibleSection title="Detail" storageKey="ui:detailOpen">
                <DetailPanel />
              </CollapsibleSection>
              <CollapsibleSection title="Relationship" storageKey="ui:relOpen">
                <PathsPanel />
              </CollapsibleSection>
            </aside>
          ) : (
            <button
              className="border-l border-gray-300 bg-white px-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              title="Expand right panel"
              onClick={() => setRightOpen(true)}
            >
              ⟨
            </button>
          )}
        </div>
      )}

      <FocalPicker />
    </div>
  );
}
