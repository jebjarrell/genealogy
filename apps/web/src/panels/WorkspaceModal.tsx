import { useState } from 'react';
import { useStore } from '../state/store.js';
import { isFileSystemAccessSupported } from '../fs/fsa.js';

// Project & workspace management (handoff §7). Connect a workspace folder, then
// create / open / rename / delete projects (each a folder on disk). A project
// holds the GEDCOM source, the op-log, SAR checklists, focal choice, and settings.

export function WorkspaceModal({ onClose }: { onClose: () => void }) {
  const workspace = useStore((s) => s.workspace);
  const workspaceName = useStore((s) => s.workspaceName);
  const projects = useStore((s) => s.projects);
  const projectName = useStore((s) => s.projectName);
  const connectWorkspace = useStore((s) => s.connectWorkspace);
  const disconnectWorkspace = useStore((s) => s.disconnectWorkspace);
  const openProjectByName = useStore((s) => s.openProjectByName);
  const renameCurrentProject = useStore((s) => s.renameCurrentProject);
  const deleteProjectByName = useStore((s) => s.deleteProjectByName);
  const folderStatus = useStore((s) => s.folderStatus);
  const reconnectWorkspace = useStore((s) => s.reconnectWorkspace);

  const [renameTo, setRenameTo] = useState('');

  const supported = isFileSystemAccessSupported();

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-3">
          <h2 className="text-base font-bold text-gray-900">
            Workspace &amp; projects
          </h2>
          <button className="text-gray-400 hover:text-gray-700" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-3">
          {!supported && (
            <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">
              This browser doesn’t support the File System Access API. Your work still
              persists locally in this browser; folder-backed projects need a
              Chromium-based browser.
            </p>
          )}

          {/* Workspace connection */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700">Workspace folder</h3>
            {workspace ? (
              <div className="mt-1 flex items-center justify-between gap-2 rounded border border-gray-200 bg-gray-50 p-2 text-sm">
                <span>
                  Connected: <span className="font-medium">{workspaceName}</span>
                </span>
                <button
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-white"
                  onClick={() => void disconnectWorkspace()}
                >
                  Disconnect
                </button>
              </div>
            ) : folderStatus === 'needs-permission' ? (
              <div className="mt-1 space-y-1">
                <p className="text-xs text-gray-600">
                  A workspace folder is remembered but needs permission again.
                </p>
                <button
                  className="rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700"
                  onClick={() => void reconnectWorkspace()}
                >
                  Reconnect folder
                </button>
              </div>
            ) : (
              <button
                className="mt-1 rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                disabled={!supported}
                onClick={() => void connectWorkspace()}
              >
                Pick workspace folder…
              </button>
            )}
          </section>

          <>
            {/* Existing projects */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700">Projects</h3>
              {projects.length === 0 ? (
                <p className="mt-1 text-xs text-gray-500">
                  No projects yet — load a GEDCOM to create one.
                </p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {projects.map((name) => (
                    <li
                      key={name}
                      className={`flex items-center justify-between gap-2 rounded border p-2 text-sm ${
                        name === projectName
                          ? 'border-blue-400 bg-blue-50'
                          : 'border-gray-200'
                      }`}
                    >
                      <span className="min-w-0 truncate">
                        {name}
                        {name === projectName && (
                          <span className="ml-1 text-[11px] text-blue-600">(open)</span>
                        )}
                        {!workspace && (
                          <span className="ml-1 text-[11px] text-gray-400">
                            (this browser)
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <button
                          className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-white"
                          onClick={() => void openProjectByName(name)}
                        >
                          Open
                        </button>
                        <button
                          className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                          onClick={() => void deleteProjectByName(name)}
                        >
                          Delete
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Rename current */}
            {projectName && (
              <section>
                <h3 className="text-sm font-semibold text-gray-700">
                  Rename current project
                </h3>
                <div className="mt-1 flex gap-2">
                  <input
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                    placeholder={projectName}
                    value={renameTo}
                    onChange={(e) => setRenameTo(e.target.value)}
                  />
                  <button
                    className="rounded border border-gray-300 px-3 py-1 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    disabled={renameTo.trim() === ''}
                    onClick={() => {
                      void renameCurrentProject(renameTo.trim());
                      setRenameTo('');
                    }}
                  >
                    Rename
                  </button>
                </div>
              </section>
            )}
          </>
        </div>
      </div>
    </div>
  );
}
