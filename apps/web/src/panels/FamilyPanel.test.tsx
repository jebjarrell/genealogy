import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { parseGedcom } from '@genealogy/core';
import minimalGed from '../../../../packages/core/tests/fixtures/minimal.ged?raw';
import { FamilyPanel } from './FamilyPanel.js';
import { DetailPanel } from './DetailPanel.js';
import { useStore } from '../state/store.js';

describe('FamilyPanel + BioSketch render', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    useStore.getState().loadModel(parseGedcom(minimalGed), 'minimal.ged');
    useStore.getState().setFocal('I3'); // William; ancestors John & Jane
  });

  it('shows ancestor analytics for the focal person', () => {
    render(<FamilyPanel />);
    expect(screen.getByText(/Family summary/i)).toBeInTheDocument();
    // 2 ancestors (John, Jane) and a longevity figure (John lived 75y).
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();
    expect(screen.getByText(/New York/)).toBeInTheDocument();
  });

  it('renders a bio sketch in the detail panel', () => {
    useStore.getState().selectPerson('I1'); // John Smith
    render(<DetailPanel />);
    // "Spouse" (singular) and "Military" are sketch-only labels; the lists below
    // use "Spouses"/event labels, and the birthplace appears in both.
    expect(screen.getByText('Spouse')).toBeInTheDocument();
    expect(screen.getByText('Military')).toBeInTheDocument();
    expect(
      screen.getAllByText(/New York, New York, United States/).length,
    ).toBeGreaterThan(0);
  });
});
