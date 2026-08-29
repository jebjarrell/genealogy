import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceModal } from './WorkspaceModal.js';
import { useStore } from '../state/store.js';

// Final review, item 7: Delete was one unconfirmed click, 4px from Open, on
// data with no other copy anywhere - no server, no backup, no trash, no undo.
describe('WorkspaceModal - deleting a project', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
  });

  const seed = () => {
    const deleteProjectByName = vi.fn().mockResolvedValue(undefined);
    useStore.setState({
      projects: ['Jarrell Tree', 'Smith Tree'],
      deleteProjectByName,
    });
    render(<WorkspaceModal onClose={() => {}} />);
    return deleteProjectByName;
  };

  it('does not delete anything on the first click', () => {
    const deleteProjectByName = seed();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete…' })[0]!);

    expect(deleteProjectByName).not.toHaveBeenCalled();
    // The confirmation names the project that is about to be destroyed.
    expect(screen.getByText(/permanently/)).toHaveTextContent(
      'Delete "Jarrell Tree" permanently?',
    );
  });

  it('deletes only after the confirmation is clicked', () => {
    const deleteProjectByName = seed();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete…' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(deleteProjectByName).toHaveBeenCalledTimes(1);
    expect(deleteProjectByName).toHaveBeenCalledWith('Jarrell Tree');
  });

  it('cancels without deleting, and re-arms cleanly', () => {
    const deleteProjectByName = seed();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete…' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteProjectByName).not.toHaveBeenCalled();
    expect(screen.queryByText(/permanently/)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Delete…' })).toHaveLength(2);
  });

  // A confirmation armed on one row must not be spendable on another: the
  // whole point is that the click that destroys data names its target.
  it('arms one project at a time', () => {
    const deleteProjectByName = seed();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete…' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete…' })); // the other row

    expect(deleteProjectByName).not.toHaveBeenCalled();
    expect(screen.getByText(/permanently/)).toHaveTextContent(
      'Delete "Smith Tree" permanently?',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteProjectByName).toHaveBeenCalledWith('Smith Tree');
  });

  it('keeps Open one click away', () => {
    const openProjectByName = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ projects: ['Jarrell Tree'], openProjectByName });
    render(<WorkspaceModal onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(openProjectByName).toHaveBeenCalledWith('Jarrell Tree');
  });
});
