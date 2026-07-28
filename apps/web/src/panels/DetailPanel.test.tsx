import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseGedcom } from '@genealogy/core';
import { DetailPanel } from './DetailPanel.js';
import { useStore } from '../state/store.js';
import { useEditorStore } from '../state/editorStore.js';

// James is listed as a child of two couples because someone attached him a
// generation too high: Ezekiel is his grandfather, not his father. Nancy really
// is Ezekiel's daughter and must survive the correction.
//
//   F1: Thomas + Mary   -> James
//   F2: Ezekiel + Sarah -> James, Nancy
const GED = `0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Thomas L /Stone/
1 SEX M
0 @I2@ INDI
1 NAME Mary /Stone/
1 SEX F
0 @I3@ INDI
1 NAME Ezekiel M /Stone/
1 SEX M
0 @I4@ INDI
1 NAME Sarah /Stone/
1 SEX F
0 @I5@ INDI
1 NAME James Edward /Stone/
1 SEX M
1 FAMC @F1@
1 FAMC @F2@
0 @I6@ INDI
1 NAME Nancy /Stone/
1 SEX F
1 FAMC @F2@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I5@
0 @F2@ FAM
1 HUSB @I3@
1 WIFE @I4@
1 CHIL @I5@
1 CHIL @I6@
0 TRLR
`;

/**
 * A relationship block, so assertions cannot accidentally match the bio sketch
 * above it. The word can appear in prose elsewhere in the panel, so match the
 * heading that actually owns a list.
 */
function section(title: string) {
  const block = screen
    .getAllByText(title)
    .map((el) => el.parentElement)
    .find((parent): parent is HTMLElement => !!parent?.querySelector('ul'));
  if (!block) throw new Error(`No relationship section titled "${title}"`);
  return block;
}

/**
 * The armed-confirmation row, which states the consequence of the removal. Its
 * sentence is split across bolded name spans, so match on the row's full text.
 */
function confirmation() {
  return screen.getByText(
    (_content, el) =>
      el?.tagName === 'LI' && /as a parent of/.test(el.textContent ?? ''),
  );
}

describe('DetailPanel — removing a parent-child link', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    useEditorStore.setState({ person: null, event: null });
    useStore.getState().loadModel(parseGedcom(GED), 'stone.ged');
    useStore.getState().setFocal('I5');
    useStore.getState().selectPerson('I5');
  });
  afterEach(() => cleanup());

  it('lists both fathers before any correction', () => {
    render(<DetailPanel />);
    const parents = within(section('Parents'));
    expect(parents.getByText('Thomas L Stone')).toBeInTheDocument();
    expect(parents.getByText('Ezekiel M Stone')).toBeInTheDocument();
  });

  it('names the co-parent that will also be removed before confirming', async () => {
    const user = userEvent.setup();
    render(<DetailPanel />);

    const row = screen.getByText('Ezekiel M Stone').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Remove/ }));

    // The consequence has to be stated: detaching a child removes the couple.
    const banner = confirmation();
    expect(banner).toHaveTextContent(
      'Remove Ezekiel M Stone as a parent of James Edward Stone',
    );
    expect(banner).toHaveTextContent('This also removes Sarah Stone');
    expect(banner).toHaveTextContent('undo it from the Review tab');
  });

  it('cancelling changes nothing', async () => {
    const user = userEvent.setup();
    render(<DetailPanel />);

    const row = screen.getByText('Ezekiel M Stone').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Remove…/ }));
    await user.click(screen.getByRole('button', { name: /Cancel/ }));

    expect(useStore.getState().ops).toEqual([]);
    expect(screen.queryByText(/This also removes/)).toBeNull();
    expect(within(section('Parents')).getByText('Ezekiel M Stone')).toBeInTheDocument();
  });

  it('removes the wrong father and his wife, keeping the right parents', async () => {
    const user = userEvent.setup();
    render(<DetailPanel />);

    const row = screen.getByText('Ezekiel M Stone').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Remove…/ }));
    await user.click(screen.getByRole('button', { name: /^Remove$/ }));

    const graph = useStore.getState().graph!;
    expect(graph.parentsOf.get('I5')!.sort()).toEqual(['I1', 'I2']);
  });

  it('leaves the wrong father his other children', async () => {
    const user = userEvent.setup();
    render(<DetailPanel />);

    const row = screen.getByText('Ezekiel M Stone').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Remove…/ }));
    await user.click(screen.getByRole('button', { name: /^Remove$/ }));

    // Nancy is genuinely Ezekiel's daughter and must not be collateral damage.
    expect(useStore.getState().graph!.childrenOf.get('I3')).toEqual(['I6']);
  });

  it('records the removal as an undoable op', async () => {
    const user = userEvent.setup();
    render(<DetailPanel />);

    const row = screen.getByText('Ezekiel M Stone').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Remove…/ }));
    await user.click(screen.getByRole('button', { name: /^Remove$/ }));

    const ops = useStore.getState().ops;
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      kind: 'unlinkRelationship',
      relation: 'parent-child',
      familyId: 'F2',
      childId: 'I5',
    });

    // Direct store mutation, so React needs to be told a render will follow.
    act(() => useStore.getState().undoOp(0));
    expect(useStore.getState().graph!.parentsOf.get('I5')!.sort()).toEqual([
      'I1',
      'I2',
      'I3',
      'I4',
    ]);
  });

  it('warns that removing a spouse also detaches them from the children', async () => {
    const user = userEvent.setup();
    useStore.getState().selectPerson('I1'); // Thomas, married to Mary, child James
    render(<DetailPanel />);

    const row = within(section('Spouses'))
      .getByText('Mary Stone')
      .closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Remove…/ }));

    const banner = screen.getByText(
      (_c, el) => el?.tagName === 'P' && /as a spouse of/.test(el.textContent ?? ''),
    );
    expect(banner).toHaveTextContent('Remove Mary Stone as a spouse of Thomas L Stone');
    expect(banner).toHaveTextContent('stop being recorded as a parent of their child');
  });

  it('removes a spouse while leaving the children with the other parent', async () => {
    const user = userEvent.setup();
    useStore.getState().selectPerson('I1');
    render(<DetailPanel />);

    const row = within(section('Spouses'))
      .getByText('Mary Stone')
      .closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Remove…/ }));
    await user.click(screen.getByRole('button', { name: /^Remove$/ }));

    const state = useStore.getState();
    expect(state.model!.families.get('F1')!.spouseIds).toEqual(['I1']);
    // James keeps Thomas, and is not orphaned by the spouse removal.
    expect(state.graph!.parentsOf.get('I5')!.sort()).toEqual(['I1', 'I3', 'I4']);
    expect(state.ops[0]).toMatchObject({
      kind: 'unlinkRelationship',
      relation: 'spouse',
      familyId: 'F1',
      spouseAId: 'I2',
    });
  });

  it('removes a child from the parent side too', async () => {
    const user = userEvent.setup();
    useStore.getState().selectPerson('I3');
    render(<DetailPanel />);

    const children = within(section('Children'));
    const row = children.getByText('James Edward Stone').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Remove…/ }));
    await user.click(screen.getByRole('button', { name: /^Remove$/ }));

    expect(useStore.getState().graph!.parentsOf.get('I5')!.sort()).toEqual([
      'I1',
      'I2',
    ]);
  });
});
