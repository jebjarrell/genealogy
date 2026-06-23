import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { parseGedcom } from '@genealogy/core';
import pedigreeGed from '../../../../packages/core/tests/fixtures/pedigree-collapse.ged?raw';
import { LocalityReport } from './LocalityReport.js';
import { useStore } from '../state/store.js';

describe('LocalityReport — research targets along a line', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    useStore.getState().loadModel(parseGedcom(pedigreeGed), 'loc.ged');
    useStore.getState().setFocal('I11');
  });
  afterEach(() => cleanup());

  it('renders place rows and flags unsourced places as research targets', () => {
    render(<LocalityReport ancestorId="I1" />);
    // The focal person's birthplace appears as a row.
    expect(screen.getByText(/Floyd, Kentucky, United States/)).toBeInTheDocument();
    // Unsourced facts are flagged.
    expect(screen.getAllByText(/research target/i).length).toBeGreaterThan(0);
    // Summary line counts the deduplicated people on the line.
    expect(screen.getByText(/people on this line/i)).toBeInTheDocument();
  });
});
