import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from './App.js';
import { useStore } from './state/store.js';

describe('<App /> smoke', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
  });

  it('shows the upload prompt before any file is loaded', () => {
    render(<App />);
    expect(screen.getByText(/Load a GEDCOM/i)).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /Load GEDCOM/i }).length,
    ).toBeGreaterThan(0);
  });
});

describe('App — save status and folder banner', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    // The real restoreSession reaches into IndexedDB (absent in jsdom) and the
    // remembered-folder-handle store, and resolves a tick after render with a
    // 'none' it derives on its own - which would stomp the folderStatus these
    // tests seed before the synchronous assertion ever runs. Neutralize it so
    // what's rendered is the state the test actually seeded, not a state that
    // gets silently overwritten a microtask later.
    useStore.setState({ restoreSession: async () => {} });
  });

  it('shows a saved indicator once a project has been saved', () => {
    useStore.setState({
      projectName: 'tree',
      saveState: { status: 'saved', lastSavedAt: new Date().toISOString() },
    });
    render(<App />);
    expect(screen.getByText(/Saved/)).toBeInTheDocument();
  });

  it('shows a saving indicator while a save is in flight', () => {
    useStore.setState({
      projectName: 'tree',
      saveState: { status: 'saving', lastSavedAt: null },
    });
    render(<App />);
    expect(screen.getByText(/Saving/)).toBeInTheDocument();
  });

  it('shows an error indicator when the save fails', () => {
    useStore.setState({
      projectName: 'tree',
      saveState: { status: 'error', lastSavedAt: null },
    });
    render(<App />);
    expect(screen.getByText(/Not saved/)).toBeInTheDocument();
  });

  // Final review, item 4: 'error' used to render one fixed sentence -
  // "storage unavailable" - for a condition that is nothing of the sort. The
  // accurate explanation lived only in `notice`, which the next edit
  // overwrites, so the true message was transient and the durable one was
  // false.
  it('distinguishes a tab conflict from a storage failure, and says so permanently', () => {
    useStore.setState({
      projectName: 'tree',
      saveState: { status: 'error', lastSavedAt: null, blockedReason: 'conflict' },
    });
    render(<App />);

    expect(screen.getByText(/Not saved/)).toHaveTextContent(/open in another tab/);
    expect(screen.queryByText(/storage unavailable/)).toBeNull();
    // Not a transient notice: a standing element that says nothing is saved.
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(/Nothing is being saved/);
    expect(banner).toHaveTextContent(/tree/);
  });

  it('keeps the conflict banner up across the edits that overwrite `notice`', () => {
    useStore.setState({
      projectName: 'tree',
      saveState: { status: 'error', lastSavedAt: null, blockedReason: 'conflict' },
    });
    render(<App />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // What every subsequent edit does to the advice the user was given.
    act(() => {
      useStore.setState({ notice: 'Person updated.' });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/Nothing is being saved/);
  });

  it('still says storage unavailable when that is what actually happened', () => {
    useStore.setState({
      projectName: 'tree',
      saveState: { status: 'error', lastSavedAt: null, blockedReason: 'storage' },
    });
    render(<App />);
    expect(screen.getByText(/storage unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the relative save time ticking instead of freezing at "just now"', () => {
    vi.useFakeTimers();
    try {
      useStore.setState({
        projectName: 'tree',
        saveState: { status: 'saved', lastSavedAt: new Date().toISOString() },
      });
      render(<App />);
      expect(screen.getByText(/Saved just now/)).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByText(/Saved 1m ago/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the folder-unavailable banner when a folder write fails', () => {
    useStore.setState({ projectName: 'tree', folderStatus: 'error' });
    render(<App />);
    expect(screen.getByText(/Can't write to the workspace folder/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reconnect/ })).toBeInTheDocument();
  });

  it('shows no banner when the folder is healthy', () => {
    useStore.setState({ projectName: 'tree', folderStatus: 'connected' });
    render(<App />);
    expect(screen.queryByText(/Can't write to the workspace folder/)).toBeNull();
  });

  it('shows the needs-permission copy and a Reconnect action', () => {
    useStore.setState({ projectName: 'tree', folderStatus: 'needs-permission' });
    render(<App />);
    expect(screen.getByText(/needs permission again/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reconnect/ })).toBeInTheDocument();
  });

  it('shows name-conflict copy with no Reconnect action, since reconnecting cannot fix it', () => {
    useStore.setState({ projectName: 'tree', folderStatus: 'name-conflict' });
    render(<App />);
    expect(
      screen.getByText(/A different family tree is already stored as/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reconnect/ })).toBeNull();
  });

  // Final review, item 2: the old copy said "Rename this project to continue
  // mirroring", while renameCurrentProject was renaming the *folder's* project
  // - the untouched tree this banner exists to protect. The instruction has to
  // match what rename now does: move ours, leave theirs alone.
  it('promises the folder copy is left alone, which is what renaming now does', () => {
    useStore.setState({ projectName: 'tree', folderStatus: 'name-conflict' });
    render(<App />);
    expect(screen.getByText(/leaves the folder/)).toBeInTheDocument();
    expect(screen.queryByText(/Rename this project to continue mirroring/)).toBeNull();
  });

  it('dismisses the banner, but re-arms it when a different failure supersedes it (C1 regression)', () => {
    useStore.setState({ projectName: 'tree', folderStatus: 'error' });
    render(<App />);
    expect(screen.getByText(/Can't write to the workspace folder/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));
    expect(screen.queryByText(/Can't write to the workspace folder/)).toBeNull();

    // The drive comes back ('error' self-heals to 'connected'), then a
    // different, unrelated problem shows up. The earlier dismissal must not
    // silence it.
    act(() => {
      useStore.setState({ folderStatus: 'connected' });
    });
    expect(screen.queryByText(/Can't write to the workspace folder/)).toBeNull();

    act(() => {
      useStore.setState({ folderStatus: 'name-conflict' });
    });
    expect(
      screen.getByText(/A different family tree is already stored as/),
    ).toBeInTheDocument();
  });

  it('flushes pending saves on visibilitychange(hidden) and pagehide, and stops after unmount', () => {
    const flushSaves = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ projectName: 'tree', flushSaves });
    const { unmount } = render(<App />);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(flushSaves).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(flushSaves).toHaveBeenCalledTimes(2);

    unmount();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
    });
    // Listeners were removed on unmount - no further calls.
    expect(flushSaves).toHaveBeenCalledTimes(2);

    // Restore jsdom's own getter for later tests/files.
    delete (document as unknown as { visibilityState?: string }).visibilityState;
  });
});
