import { describe, it, expect, beforeEach } from 'vitest';
import { parseGedcom } from '@genealogy/core';
import pedigreeGed from '../../../../packages/core/tests/fixtures/pedigree-collapse.ged?raw';
import cousinsGed from '../../../../packages/core/tests/fixtures/cousins.ged?raw';
import brokenGed from '../../../../packages/core/tests/fixtures/broken.ged?raw';
import { useStore } from './store.js';

describe('app store — end-to-end flow against the sample (TRD §12.2 smoke)', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
  });

  it('loads a file, picks a sensible focal person, and renders an ego network', () => {
    useStore.getState().loadModel(parseGedcom(pedigreeGed), 'pedigree-collapse.ged');
    const s = useStore.getState();
    expect(s.focalPersonId).toBe('I11'); // youngest leaf
    expect(s.view!.nodes.length).toBe(11);
    expect(s.view!.nodes.find((n) => n.person.id === 'I11')!.isFocal).toBe(true);
  });

  it('marks the pedigree-collapse points', () => {
    useStore.getState().loadModel(parseGedcom(pedigreeGed), 'pedigree-collapse.ged');
    const ids = useStore
      .getState()
      .collapsePoints.map((c) => c.ancestorId)
      .sort();
    expect(ids).toEqual(['I1', 'I2']);
    expect(
      useStore.getState().view!.nodes.find((n) => n.person.id === 'I1')!
        .isPedigreeCollapsePoint,
    ).toBe(true);
  });

  it('selecting two people then showing paths highlights every distinct path', () => {
    useStore.getState().loadModel(parseGedcom(pedigreeGed), 'pedigree-collapse.ged');
    const { selectPerson, showRelationship } = useStore.getState();
    selectPerson('I11');
    selectPerson('I1');
    expect(useStore.getState().selectedIds).toEqual(['I11', 'I1']);
    showRelationship('I11', 'I1');
    const hl = useStore.getState().highlight!;
    expect(hl.paths).toHaveLength(2);
    expect(hl.nodeIds.has('I1')).toBe(true);
    expect(hl.nodeIds.has('I11')).toBe(true);
  });

  it('expands a person in place, growing the visible set', () => {
    useStore.getState().loadModel(parseGedcom(cousinsGed), 'cousins.ged');
    const before = useStore.getState().view!.nodes.length;
    const expandable = useStore
      .getState()
      .view!.nodes.find((n) => n.hasUnexpandedNeighbors);
    expect(expandable).toBeDefined();
    useStore.getState().expand(expandable!.person.id, 'all');
    expect(useStore.getState().view!.nodes.length).toBeGreaterThan(before);
  });

  it('surfaces warnings from a malformed file without throwing', () => {
    useStore.getState().loadModel(parseGedcom(brokenGed), 'broken.ged');
    const s = useStore.getState();
    expect(s.view).not.toBeNull();
    expect(s.warnings.some((w) => w.severity === 'warning')).toBe(true);
  });
});
