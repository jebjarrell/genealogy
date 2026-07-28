import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseGedcom } from '@genealogy/core';
import { AttachPersonModal } from './AttachPersonModal.js';
import { useStore } from '../state/store.js';
import { useEditorStore } from '../state/editorStore.js';

//   F1: Henry (I1) + Catherine (I2) -> Mary (I4)
//   F2: Henry (I1) + Anne (I3)      -> Elizabeth (I5)
//   I6 Orphan has no family at all.
// Henry's two marriages are the ambiguity the family chooser exists for.
const GED = `0 HEAD
0 @I1@ INDI
1 NAME Henry /King/
1 SEX M
1 BIRT
2 DATE 1820
1 FAMS @F1@
1 FAMS @F2@
0 @I2@ INDI
1 NAME Catherine /First/
1 SEX F
1 FAMS @F1@
0 @I3@ INDI
1 NAME Anne /Second/
1 SEX F
1 FAMS @F2@
0 @I4@ INDI
1 NAME Mary /King/
1 SEX F
1 BIRT
2 DATE 1845
1 FAMC @F1@
0 @I5@ INDI
1 NAME Elizabeth /King/
1 SEX F
1 BIRT
2 DATE 1855
1 FAMC @F2@
0 @I6@ INDI
1 NAME Orphan /Nobody/
1 SEX M
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I4@
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I3@
1 CHIL @I5@
0 TRLR
`;

/**
 * Type a query and pick a result. Scoped to the results list because the
 * "Create a new person <query>" fallback echoes the query and would otherwise
 * match the same name.
 */
async function searchAndPick(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.type(screen.getByLabelText(/Search by name/i), name);
  const list = await screen.findByRole('list');
  await user.click(within(list).getByRole('button', { name: new RegExp(name, 'i') }));
}

describe('AttachPersonModal', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    useEditorStore.setState({ person: null, event: null, attach: null });
    useStore.getState().loadModel(parseGedcom(GED), 'attach.ged');
    useStore.getState().setFocal('I1');
  });
  afterEach(() => cleanup());

  it('renders nothing until an attach is requested', () => {
    const { container } = render(<AttachPersonModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it('links an existing person into the only candidate family', async () => {
    const user = userEvent.setup();
    // Mary is a child of F1; adding a parent should join F1, not create one.
    useEditorStore.getState().openAttach('parent', 'I4');
    render(<AttachPersonModal />);

    await searchAndPick(user, 'Orphan');
    // Only one candidate family, so no chooser appears.
    expect(screen.queryByText(/Which family/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Link$/ }));

    const model = useStore.getState().model!;
    expect(model.families.get('F1')!.spouseIds.sort()).toEqual(['I1', 'I2', 'I6']);
    expect(model.families.has('FU1')).toBe(false);
  });

  it('asks which marriage when the anchor has more than one', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().openAttach('child', 'I1'); // Henry, married twice
    render(<AttachPersonModal />);

    await searchAndPick(user, 'Orphan');

    expect(screen.getByText(/Which family/i)).toBeInTheDocument();
    expect(screen.getByText(/Henry King and Catherine First/)).toBeInTheDocument();
    expect(screen.getByText(/Henry King and Anne Second/)).toBeInTheDocument();
    // Linking is held until a family is chosen.
    expect(screen.getByRole('button', { name: /^Link$/ })).toBeDisabled();
  });

  it('joins the marriage that was chosen', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().openAttach('child', 'I1');
    render(<AttachPersonModal />);

    await searchAndPick(user, 'Orphan');
    await user.click(screen.getByRole('radio', { name: /Anne Second/ }));
    await user.click(screen.getByRole('button', { name: /^Link$/ }));

    const model = useStore.getState().model!;
    expect(model.families.get('F2')!.childIds).toEqual(['I5', 'I6']);
    expect(model.families.get('F1')!.childIds).toEqual(['I4']);
  });

  it('can still create a new family instead of joining one', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().openAttach('child', 'I1');
    render(<AttachPersonModal />);

    await searchAndPick(user, 'Orphan');
    await user.click(screen.getByRole('radio', { name: /A new family/ }));
    await user.click(screen.getByRole('button', { name: /^Link$/ }));

    const model = useStore.getState().model!;
    expect(model.families.get('FU1')!.childIds).toEqual(['I6']);
    expect(model.families.get('F1')!.childIds).toEqual(['I4']);
  });

  it('refuses a link that would make someone their own ancestor', async () => {
    const user = userEvent.setup();
    // Mary is Henry's daughter; making her his parent is circular.
    useEditorStore.getState().openAttach('parent', 'I1');
    render(<AttachPersonModal />);

    await searchAndPick(user, 'Mary');

    expect(screen.getByText(/own ancestor/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be recorded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Link$/ })).toBeDisabled();
    expect(useStore.getState().ops).toEqual([]);
  });

  it('warns about an implausible link but still allows it', async () => {
    const user = userEvent.setup();
    // Elizabeth b.1855 as a parent of Mary b.1845. They are half-sisters, so
    // this is not circular - just chronologically impossible.
    useEditorStore.getState().openAttach('parent', 'I4');
    render(<AttachPersonModal />);

    await searchAndPick(user, 'Elizabeth');

    expect(
      screen.getByText(/born in 1855, after Mary King in 1845/i),
    ).toBeInTheDocument();
    const link = screen.getByRole('button', { name: /^Link$/ });
    expect(link).toBeEnabled();

    await user.click(link);
    expect(useStore.getState().ops).toHaveLength(1);
  });

  it('hands off to the person editor when creating someone new', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().openAttach('parent', 'I4');
    render(<AttachPersonModal />);

    await user.type(screen.getByLabelText(/Search by name/i), 'Nobody Here');
    await user.click(screen.getByRole('button', { name: /Create a new person/ }));

    expect(useEditorStore.getState().attach).toBeNull();
    expect(useEditorStore.getState().person).toEqual({
      mode: 'add',
      attach: { relation: 'parent', personId: 'I4' },
    });
  });

  it('does not offer the anchor as a match for themselves', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().openAttach('spouse', 'I1');
    render(<AttachPersonModal />);

    await user.type(screen.getByLabelText(/Search by name/i), 'King');
    const list = screen.getByRole('list');
    expect(within(list).queryByRole('button', { name: /Henry King/ })).toBeNull();
    expect(within(list).getByRole('button', { name: /Mary King/ })).toBeInTheDocument();
  });
});
