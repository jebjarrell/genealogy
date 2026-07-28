import { describe, it, expect, beforeEach } from 'vitest';
import { parseGedcom } from '@genealogy/core';
import pedigreeGed from '../../../../packages/core/tests/fixtures/pedigree-collapse.ged?raw';
import cousinsGed from '../../../../packages/core/tests/fixtures/cousins.ged?raw';
import brokenGed from '../../../../packages/core/tests/fixtures/broken.ged?raw';
import marriagesGed from '../../../../packages/core/tests/fixtures/multiple-marriages.ged?raw';
import { useStore } from './store.js';

const load = (ged: string, name = 'test.ged') =>
  useStore.getState().loadModel(parseGedcom(ged), name);
const ids = () => useStore.getState().view!.nodes.map((n) => n.person.id);

// A minimal file that declares its root person via the GEDCOM header's _ROOT
// extension tag, exercising the branch of loadModel that pedigree-collapse.ged
// (no declared root) deliberately does not.
const declaredRootGed = `0 HEAD
1 SOUR Test
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
1 _ROOT @I2@
0 @I1@ INDI
1 NAME Parent /Root/
1 SEX M
1 FAMS @F1@
0 @I2@ INDI
1 NAME Child /Root/
1 SEX F
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 CHIL @I2@
0 TRLR
`;

describe('app store — focal-on-load (TRD §13)', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('prompts (opens the picker) when there is no declared/remembered focal', () => {
    load(pedigreeGed);
    const s = useStore.getState();
    expect(s.focalPersonId).toBeNull();
    expect(s.focalPickerOpen).toBe(true);
    expect(s.view).toBeNull();
  });

  // localStorage's per-file `genealogy:focal:` key is gone (Task 10). Focal
  // recall across a reload is now the session store's job and is covered by
  // restore.test.ts ("reopens the last project with its model, ops, and focal
  // person"). What's left worth proving here, with loadModel's in-memory-only
  // path, is the other input to focal selection: a root person declared right
  // in the GEDCOM header, which nothing else in this suite exercises.
  it('honours the focal person declared in the GEDCOM header', () => {
    load(declaredRootGed, 'declared.ged');
    const s = useStore.getState();
    expect(s.focalPersonId).toBe('I2');
    expect(s.focalPickerOpen).toBe(false);
  });

  it('setFocal builds the ego network centred on the chosen person', () => {
    load(pedigreeGed);
    useStore.getState().setFocal('I11');
    const s = useStore.getState();
    expect(s.focalPersonId).toBe('I11');
    // Not just the focal node itself: both of Paul's ancestor lines should be
    // pulled into view (see pedigree-collapse.ged's header note).
    expect(ids()).toEqual(expect.arrayContaining(['I11', 'I7', 'I3', 'I1']));
    expect(s.view!.nodes.find((n) => n.person.id === 'I11')!.isFocal).toBe(true);
  });
});

describe('app store — ego network & collapse', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('renders the focal-centred ego network and marks collapse points', () => {
    load(pedigreeGed);
    useStore.getState().setFocal('I11');
    const s = useStore.getState();
    expect(s.view!.nodes.find((n) => n.person.id === 'I11')!.isFocal).toBe(true);
    expect(s.collapsePoints.map((c) => c.ancestorId).sort()).toEqual(['I1', 'I2']);
    expect(
      s.view!.nodes.find((n) => n.person.id === 'I1')!.isPedigreeCollapsePoint,
    ).toBe(true);
  });

  it('defaults to direct ancestors only — no step-relatives until Spouses is on', () => {
    // In multiple-marriages.ged, Mary (@I4@) descends from Henry (@I1@) + Catherine
    // (@I2@). Henry's other wife Anne (@I3@) is a step-relative, not Mary's ancestor.
    load(marriagesGed);
    useStore.getState().setFocal('I4');
    expect(ids()).not.toContain('I3'); // hidden by default (direct ancestors only)
    useStore.getState().setViewOptions({ includeSpouses: true });
    expect(ids()).toContain('I3'); // appears once spouses are shown
    useStore.getState().setViewOptions({ includeSpouses: false });
    expect(ids()).not.toContain('I3');
  });

  it('Siblings toggle reveals siblings (full & half) of people in view', () => {
    // Focal Mary (@I4@): her siblings are Edward (@I5@, full) and Elizabeth
    // (@I6@, half via father). Neither is a direct ancestor → hidden by default.
    load(marriagesGed);
    useStore.getState().setFocal('I4');
    expect(ids()).not.toContain('I5');
    expect(ids()).not.toContain('I6');
    useStore.getState().setViewOptions({ showSiblings: true });
    expect(ids()).toContain('I5');
    expect(ids()).toContain('I6');
    useStore.getState().setViewOptions({ showSiblings: false });
    expect(ids()).not.toContain('I5');
  });
});

describe('app store — selection, deselection, reset', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    load(pedigreeGed);
    useStore.getState().setFocal('I11');
  });

  it('toggles selection and supports explicit deselect', () => {
    const { selectPerson, deselectPerson } = useStore.getState();
    selectPerson('I11');
    selectPerson('I1');
    expect(useStore.getState().selectedIds).toEqual(['I11', 'I1']);
    selectPerson('I1'); // re-click deselects
    expect(useStore.getState().selectedIds).toEqual(['I11']);
    deselectPerson('I11');
    expect(useStore.getState().selectedIds).toEqual([]);
  });

  it('highlights every distinct path between two selected people', () => {
    useStore.getState().showRelationship('I11', 'I1');
    const hl = useStore.getState().highlight!;
    expect(hl.paths).toHaveLength(2);
    expect(hl.nodeIds.has('I1')).toBe(true);
  });

  it('resetView drops expansions, selection, and highlight', () => {
    const before = ids().length;
    const expandable = useStore
      .getState()
      .view!.nodes.find((n) => n.hasUnexpandedNeighbors);
    if (expandable) useStore.getState().expand(expandable.person.id, 'all');
    useStore.getState().selectPerson('I3');
    useStore.getState().resetView();
    expect(useStore.getState().selectedIds).toEqual([]);
    expect(useStore.getState().highlight).toBeNull();
    expect(ids().length).toBe(before);
  });
});

describe('app store — expand & malformed input', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('expands a person in place, growing the visible set', () => {
    load(cousinsGed);
    useStore.getState().setFocal('I12');
    const before = ids().length;
    const expandable = useStore
      .getState()
      .view!.nodes.find((n) => n.hasUnexpandedNeighbors);
    expect(expandable).toBeDefined();
    useStore.getState().expand(expandable!.person.id, 'all');
    expect(ids().length).toBeGreaterThan(before);
  });

  it('surfaces warnings from a malformed file without throwing', () => {
    load(brokenGed);
    const s = useStore.getState();
    expect(s.warnings.some((w) => w.severity === 'warning')).toBe(true);
  });
});
