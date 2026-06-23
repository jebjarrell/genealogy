import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { parseGedcom, linkKey, SERVICE_KEY } from '@genealogy/core';
import pedigreeGed from '../../../../packages/core/tests/fixtures/pedigree-collapse.ged?raw';
import { SarPanel } from './SarPanel.js';
import { useStore } from '../state/store.js';

describe('SarPanel — checklist surface', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    useStore.getState().loadModel(parseGedcom(pedigreeGed), 'sar.ged');
    useStore.getState().setFocal('I11');
  });
  afterEach(() => cleanup());

  it('renders a generated checklist with lineage links and a service item', () => {
    act(() => {
      useStore.getState().createChecklist('I1');
    });
    render(<SarPanel />);
    expect(screen.getByText(/Patriot: Alfred Root/)).toBeInTheDocument();
    // The patriot's service item is tracked separately.
    expect(screen.getByText(SAR_SERVICE_TEXT)).toBeInTheDocument();
    // 0 of N proven initially; everything unproven.
    expect(screen.getByText(/0 \/ \d+ proven/)).toBeInTheDocument();
    expect(screen.getAllByText('unproven').length).toBeGreaterThan(0);
  });

  it('reflects a post-1985 record copy spanning generations as proven', () => {
    let id = '';
    act(() => {
      id = useStore.getState().createChecklist('I1');
    });
    act(() => {
      useStore.getState().addChecklistProof(id, {
        kind: 'record-copy',
        coveredKeys: [linkKey('I11', 'I7'), linkKey('I7', 'I3'), linkKey('I3', 'I1')],
        society: 'DAR',
        nationalNumber: '123456',
        patriotName: 'Alfred Root',
        approvedYear: 1992,
      });
    });
    render(<SarPanel />);
    expect(screen.getAllByText('record copy').length).toBeGreaterThanOrEqual(3);
  });

  it('flags a pre-1985 record copy as insufficient', () => {
    let id = '';
    act(() => {
      id = useStore.getState().createChecklist('I1');
    });
    act(() => {
      useStore.getState().addChecklistProof(id, {
        kind: 'record-copy',
        coveredKeys: [SERVICE_KEY],
        society: 'SAR',
        nationalNumber: '777',
        patriotName: 'Alfred Root',
        approvedYear: 1979,
      });
    });
    render(<SarPanel />);
    expect(screen.getByText(/pre-1985, insufficient alone/)).toBeInTheDocument();
  });
});

const SAR_SERVICE_TEXT = 'Patriot Revolutionary War service (1775–1783)';
