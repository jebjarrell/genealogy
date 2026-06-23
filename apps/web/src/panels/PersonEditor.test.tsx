import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseGedcom } from '@genealogy/core';
import { PersonEditor } from './PersonEditor.js';
import { useStore } from '../state/store.js';
import { useEditorStore } from '../state/editorStore.js';

const GED = `0 HEAD
0 @I1@ INDI
1 NAME Me /Doe/
1 SEX M
0 TRLR
`;

describe('PersonEditor — add a relative', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    useEditorStore.setState({ person: null, event: null });
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    useStore.getState().loadModel(parseGedcom(GED), 'pe.ged');
    useStore.getState().setFocal('I1');
  });
  afterEach(() => cleanup());

  it('adds a user-supplied parent and links it through the op-log', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().openAddPerson({ relation: 'parent', personId: 'I1' });
    render(<PersonEditor />);

    expect(screen.getByText(/New parent of/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Given name/i), 'Grandpa');
    await user.type(screen.getByLabelText(/Surname/i), 'Doe');
    await user.click(screen.getByRole('button', { name: /Add person/i }));

    const state = useStore.getState();
    const added = [...state.model!.persons.values()].find(
      (p) => p.names[0]!.full === 'Grandpa Doe',
    );
    expect(added).toBeDefined();
    expect(added!.userSupplied).toBe(true);
    // Linked as a parent of I1.
    expect(state.graph!.parentsOf.get('I1')).toContain(added!.id);
    // The editor closed.
    expect(useEditorStore.getState().person).toBeNull();
  });
});
