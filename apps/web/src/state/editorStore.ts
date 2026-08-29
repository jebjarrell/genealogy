import { create } from 'zustand';

// Ephemeral UI state for the manual-edit modals (person editor, event editor).
// Kept separate from the main data store so the data store stays focused on the
// model + op-log; this only tracks which modal is open and its parameters.

export type AttachRelation = 'parent' | 'child' | 'spouse';

export interface PersonEditorState {
  mode: 'add' | 'edit';
  /** For edit: the person being edited. */
  personId?: string;
  /** For add: attach the new person to an existing one. */
  attach?: { relation: AttachRelation; personId: string };
}

export interface EventEditorState {
  /** The person the event belongs to. */
  personId: string;
  /** For edit: the event being edited. */
  eventId?: string;
}

/** Attaching someone to `personId`; the modal decides new-vs-existing. */
export interface AttachState {
  relation: AttachRelation;
  personId: string;
}

interface EditorStore {
  person: PersonEditorState | null;
  event: EventEditorState | null;
  attach: AttachState | null;
  openAddPerson: (attach?: PersonEditorState['attach']) => void;
  openEditPerson: (personId: string) => void;
  closePerson: () => void;
  openAttach: (relation: AttachRelation, personId: string) => void;
  closeAttach: () => void;
  openAddEvent: (personId: string) => void;
  openEditEvent: (personId: string, eventId: string) => void;
  closeEvent: () => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  person: null,
  event: null,
  attach: null,
  openAddPerson: (attach) =>
    set({ person: { mode: 'add', ...(attach ? { attach } : {}) } }),
  openEditPerson: (personId) => set({ person: { mode: 'edit', personId } }),
  closePerson: () => set({ person: null }),
  openAttach: (relation, personId) => set({ attach: { relation, personId } }),
  closeAttach: () => set({ attach: null }),
  openAddEvent: (personId) => set({ event: { personId } }),
  openEditEvent: (personId, eventId) => set({ event: { personId, eventId } }),
  closeEvent: () => set({ event: null }),
}));
