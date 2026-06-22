import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { parseGedcom } from '@genealogy/core';
import { ReviewPanel } from './ReviewPanel.js';
import { MergeConfirm } from './MergeConfirm.js';
import { useStore } from '../state/store.js';

const GED = `0 HEAD
0 @I1@ INDI
1 NAME Child /X/
1 FAMC @F1@
0 @I2@ INDI
1 NAME Pa /X/
1 SEX M
1 FAMS @F1@
0 @I3@ INDI
1 NAME Ma /X/
1 SEX F
1 FAMS @F1@
0 @I3DUP@ INDI
1 NAME Ma /X/
1 SEX F
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I3@
1 CHIL @I1@
0 TRLR
`;

describe('ReviewPanel + MergeConfirm render', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    useStore.getState().loadModel(parseGedcom(GED), 'review.ged');
    useStore.getState().setFocal('I1');
  });

  it('lists an applied merge with an undo control and export buttons', () => {
    useStore.getState().mergePeople('I3', 'I3DUP');
    render(<ReviewPanel />);
    expect(screen.getByText(/Merges \(1\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Undo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export GEDCOM/i })).toBeInTheDocument();
  });

  it('shows the empty state before any merge', () => {
    render(<ReviewPanel />);
    expect(screen.getByText(/No merges yet/i)).toBeInTheDocument();
  });

  it('previews a merge when two people are selected', () => {
    useStore.setState({ selectedIds: ['I3', 'I3DUP'], mergeOpen: true });
    render(<MergeConfirm />);
    expect(screen.getByText(/Merge two people/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Merge$/ })).toBeInTheDocument();
  });
});
