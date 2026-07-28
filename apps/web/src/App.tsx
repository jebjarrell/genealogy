import { useEffect, useState } from 'react';
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
import { FamilyPanel } from './panels/FamilyPanel.js';
import { ReviewPanel } from './panels/ReviewPanel.js';
import { MergeConfirm } from './panels/MergeConfirm.js';
import { SarPanel } from './panels/SarPanel.js';
import { VaultPanel } from './panels/VaultPanel.js';
import { PersonEditor } from './panels/PersonEditor.js';
import { AttachPersonModal } from './panels/AttachPersonModal.js';
import { EventEditor } from './panels/EventEditor.js';
import { WorkspaceModal } from './panels/WorkspaceModal.js';

type LeftTab = 'search' | 'collapse';
type MainView = 'graph' | 'map' | 'family' | 'sar' | 'vault' | 'review';

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

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 1000),
  );
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function SaveIndicator() {
  const status = useStore((s) => s.saveState.status);
  const lastSavedAt = useStore((s) => s.saveState.lastSavedAt);
  const blockedReason = useStore((s) => s.saveState.blockedReason);
  const projectName = useStore((s) => s.projectName);
  // relativeTime() is computed at render, and nothing re-renders this on its
  // own between saves - so "Saved just now" froze there for as long as the user
  // kept reading instead of typing. Tick it along on the coarsest interval the
  // wording can distinguish.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!projectName) return null;
  if (status === 'saving') return <span className="text-gray-500"> · Saving…</span>;
  if (status === 'error')
    return (
      <span className="text-red-600">
        {blockedReason === 'conflict'
          ? ' · Not saved — open in another tab'
          : ' · Not saved — storage unavailable'}
      </span>
    );
  if (status === 'saved' && lastSavedAt)
    return <span className="text-gray-500"> · Saved {relativeTime(lastSavedAt)}</span>;
  return null;
}

/**
 * A cross-tab conflict, stated permanently. It cannot live in `notice` (the
 * next edit overwrites it) and it cannot live in the save indicator alone (four
 * words in a header, for the condition where nothing the user types is being
 * written anywhere). No Dismiss: there is nothing to acknowledge, only
 * something to act on.
 */
function ConflictBanner() {
  const blockedReason = useStore((s) => s.saveState.blockedReason);
  const projectName = useStore((s) => s.projectName);
  if (blockedReason !== 'conflict' || !projectName) return null;
  return (
    <div
      role="alert"
      className="border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900"
    >
      <span className="font-semibold">Nothing is being saved.</span> &quot;
      {projectName}&quot; is open in another tab, and that tab has saved changes since
      this one did. To avoid overwriting them, this tab has stopped writing — to the
      browser and to the workspace folder. Reload this page to pick up the other
      tab&apos;s version; anything you have changed here since will be lost.
    </div>
  );
}

function FolderBanner() {
  const folderStatus = useStore((s) => s.folderStatus);
  const projectName = useStore((s) => s.projectName);
  const reconnectWorkspace = useStore((s) => s.reconnectWorkspace);
  const [dismissed, setDismissed] = useState(false);

  // A dismissal only ever applies to the status the user saw when they
  // clicked it. A self-heal to 'connected' and then a *different* failure
  // (or the reverse) must render again - one Dismiss must not silence every
  // future problem for the rest of the session.
  useEffect(() => {
    setDismissed(false);
  }, [folderStatus]);

  if (dismissed) return null;
  if (
    folderStatus !== 'error' &&
    folderStatus !== 'needs-permission' &&
    folderStatus !== 'name-conflict'
  )
    return null;

  if (folderStatus === 'name-conflict') {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        <span>
          A different family tree is already stored as &quot;{projectName}&quot; in your
          workspace folder, so this project is not being mirrored there. Your work is
          saved in this browser. Renaming this project (Workspace ▸ Rename current
          project) mirrors it under the new name and leaves the folder&apos;s &quot;
          {projectName}&quot; exactly as it is.
        </span>
        <span className="flex shrink-0 gap-2">
          <button
            className="rounded border border-amber-300 px-2 py-0.5 text-xs hover:bg-amber-100"
            onClick={() => setDismissed(true)}
          >
            Dismiss
          </button>
        </span>
      </div>
    );
  }

  const isError = folderStatus === 'error';
  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span>
        {isError
          ? "Can't write to the workspace folder. Your work is saved in this browser."
          : 'The workspace folder needs permission again. Your work is saved in this browser.'}
      </span>
      <span className="flex shrink-0 gap-2">
        <button
          className="rounded bg-amber-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-amber-700"
          onClick={() => void reconnectWorkspace()}
        >
          Reconnect
        </button>
        <button
          className="rounded border border-amber-300 px-2 py-0.5 text-xs hover:bg-amber-100"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </span>
    </div>
  );
}

const TABS: { id: MainView; label: string; title: string }[] = [
  { id: 'graph', label: 'Graph', title: 'Interactive ego-centric pedigree' },
  { id: 'map', label: 'Map', title: 'Migration map for an ancestral line' },
  { id: 'family', label: 'Family', title: 'Family statistics across your ancestors' },
  { id: 'sar', label: 'SAR', title: 'SAR proof checklist + evidence linking' },
  { id: 'vault', label: 'Vault', title: 'Your document vault' },
  { id: 'review', label: 'Review', title: 'Edit history, export, and locality report' },
];

export function App() {
  const model = useStore((s) => s.model);
  const fileName = useStore((s) => s.fileName);
  const projectName = useStore((s) => s.projectName);
  const workspaceName = useStore((s) => s.workspaceName);
  const openFocalPicker = useStore((s) => s.openFocalPicker);
  const restoreSession = useStore((s) => s.restoreSession);
  const flushSaves = useStore((s) => s.flushSaves);
  const focalName = useStore((s) => {
    if (!s.model || !s.focalPersonId) return null;
    return s.model.persons.get(s.focalPersonId)?.names[0]?.full ?? s.focalPersonId;
  });
  const [leftTab, setLeftTab] = useState<LeftTab>('collapse');
  const [leftOpen, setLeftOpen] = usePersisted('ui:leftOpen', true);
  const [rightOpen, setRightOpen] = usePersisted('ui:rightOpen', true);
  const [mainView, setMainView] = useState<MainView>('graph');
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  // Restore the last project and re-bind the folder (both no-ops when absent).
  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  // A 300ms debounce means an edit made just before the tab closes would
  // otherwise be lost. Flush on the last events the browser reliably delivers.
  useEffect(() => {
    const flush = () => void flushSaves();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [flushSaves]);

  return (
    <div className="flex h-full flex-col bg-gray-100 text-gray-900">
      <header className="flex items-center justify-between border-b border-gray-300 bg-white px-4 py-2">
        <div>
          <h1 className="text-base font-bold">Genealogy Knowledge Graph Viewer</h1>
          <div className="text-xs text-gray-500">
            {projectName && (
              <span className="font-medium text-gray-700">{projectName} · </span>
            )}
            {fileName}
            <SaveIndicator />
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
        </div>
        <div className="flex items-center gap-3">
          {model && (
            <div className="flex overflow-hidden rounded border border-gray-300 text-sm">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  className={`px-3 py-1 ${
                    mainView === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-white hover:bg-gray-100'
                  }`}
                  onClick={() => setMainView(tab.id)}
                  title={tab.title}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
          <button
            className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100"
            onClick={() => setWorkspaceOpen(true)}
            title="Workspace and projects"
          >
            {workspaceName ? `📁 ${workspaceName}` : '📁 Workspace'}
          </button>
          <UploadButton />
        </div>
      </header>
      <ConflictBanner />
      <FolderBanner />

      {!model ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="max-w-md text-gray-600">
            Load a GEDCOM (<code>.ged</code>) file to explore your family tree as an
            interactive, ego-centric graph — with pedigree-collapse detection, manual
            editing, a document vault, and an SAR proof checklist. Everything happens in
            your browser; your files stay on your machine.
          </p>
          <div className="flex items-center gap-2">
            <UploadButton />
            <button
              className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100"
              onClick={() => setWorkspaceOpen(true)}
            >
              Open a project…
            </button>
          </div>
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
            {mainView === 'graph' && (
              <>
                <ViewControls />
                <GraphCanvas />
              </>
            )}
            {mainView === 'map' && <MapView />}
            {mainView === 'family' && <FamilyPanel />}
            {mainView === 'sar' && <SarPanel />}
            {mainView === 'vault' && <VaultPanel />}
            {mainView === 'review' && <ReviewPanel />}
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
      <MergeConfirm />
      <PersonEditor />
      <AttachPersonModal />
      <EventEditor />
      {workspaceOpen && <WorkspaceModal onClose={() => setWorkspaceOpen(false)} />}
    </div>
  );
}
