import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  });

  it('shows a saved indicator once a project has been saved', () => {
    useStore.setState({
      projectName: 'tree',
      saveState: { status: 'saved', lastSavedAt: new Date().toISOString() },
    });
    render(<App />);
    expect(screen.getByText(/Saved/)).toBeInTheDocument();
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
});
