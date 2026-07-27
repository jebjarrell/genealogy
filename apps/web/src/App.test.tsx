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
      screen.getByText(/already exists in your workspace folder/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reconnect/ })).toBeNull();
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
      screen.getByText(/already exists in your workspace folder/),
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
