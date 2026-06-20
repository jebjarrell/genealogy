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
