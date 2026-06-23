import { useEffect, useState } from 'react';
import type { Sex } from '@genealogy/core';
import { useStore } from '../state/store.js';
import { useEditorStore } from '../state/editorStore.js';
import { primaryName } from '../graph/personDisplay.js';

// Add/edit a person (handoff §3). Names round-trip through the GEDCOM parser via
// raw "Given /Surname/" strings; sex and notes are plain. On add, the person can
// be attached to an existing relative in the same action.

const RELATION_LABEL: Record<string, string> = {
  parent: 'parent of',
  child: 'child of',
  spouse: 'spouse of',
};

function splitName(raw: string): { given: string; surname: string } {
  const first = raw.indexOf('/');
  if (first === -1) return { given: raw.trim(), surname: '' };
  const second = raw.indexOf('/', first + 1);
  return {
    given: raw.slice(0, first).trim(),
    surname: (second === -1 ? raw.slice(first + 1) : raw.slice(first + 1, second)).trim(),
  };
}

export function PersonEditor() {
  const state = useEditorStore((s) => s.person);
  const close = useEditorStore((s) => s.closePerson);
  const model = useStore((s) => s.model);
  const addPerson = useStore((s) => s.addPerson);
  const editPerson = useStore((s) => s.editPerson);
  const linkRelationship = useStore((s) => s.linkRelationship);

  const [given, setGiven] = useState('');
  const [surname, setSurname] = useState('');
  const [aka, setAka] = useState('');
  const [sex, setSex] = useState<Sex>('unknown');
  const [notes, setNotes] = useState('');

  const editing = state?.mode === 'edit' ? state.personId : undefined;

  useEffect(() => {
    if (!state) return;
    if (state.mode === 'edit' && state.personId && model) {
      const p = model.persons.get(state.personId);
      if (p) {
        const { given: g, surname: s } = splitName(p.names[0]?.raw ?? p.names[0]?.full ?? '');
        setGiven(g);
        setSurname(s);
        setAka(p.names[1]?.full ?? '');
        setSex(p.sex);
        setNotes((p.notes ?? []).join('\n'));
        return;
      }
    }
    setGiven('');
    setSurname('');
    setAka('');
    setSex('unknown');
    setNotes('');
  }, [state, model]);

  if (!state || !model) return null;

  const attachName =
    state.attach && model.persons.get(state.attach.personId)
      ? primaryName(model.persons.get(state.attach.personId)!)
      : null;

  const save = () => {
    const nameRaws: string[] = [`${given.trim()} /${surname.trim()}/`.trim()];
    if (aka.trim()) nameRaws.push(aka.trim());
    const notesArr = notes
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean);

    if (state.mode === 'edit' && editing) {
      editPerson(editing, { nameRaws, sex, notes: notesArr });
    } else {
      const id = addPerson({ nameRaws, sex, notes: notesArr });
      if (id && state.attach) {
        const { relation, personId } = state.attach;
        if (relation === 'parent') linkRelationship('parent-child', { parentId: id, childId: personId });
        else if (relation === 'child') linkRelationship('parent-child', { parentId: personId, childId: id });
        else linkRelationship('spouse', { spouseAId: personId, spouseBId: id });
      }
    }
    close();
  };

  const canSave = given.trim() !== '' || surname.trim() !== '';

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="border-b border-gray-200 p-3">
          <h2 className="text-base font-bold text-gray-900">
            {state.mode === 'edit' ? 'Edit person' : 'Add person'}
          </h2>
          {attachName && (
            <p className="text-xs text-gray-500">
              New {RELATION_LABEL[state.attach!.relation]}{' '}
              <span className="font-medium">{attachName}</span>
            </p>
          )}
        </div>

        <div className="space-y-3 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Given name
              </span>
              <input
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1"
                value={given}
                onChange={(e) => setGiven(e.target.value)}
                autoFocus
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Surname
              </span>
              <input
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1"
                value={surname}
                onChange={(e) => setSurname(e.target.value)}
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Also known as (optional)
            </span>
            <input
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1"
              value={aka}
              onChange={(e) => setAka(e.target.value)}
              placeholder="alternate full name"
            />
          </label>

          <label className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Sex
            </span>
            <select
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1"
              value={sex}
              onChange={(e) => setSex(e.target.value as Sex)}
            >
              <option value="unknown">Unknown</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Notes (one per line)
            </span>
            <textarea
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 p-3">
          <button
            className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
            onClick={close}
          >
            Cancel
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            disabled={!canSave}
            onClick={save}
          >
            {state.mode === 'edit' ? 'Save changes' : 'Add person'}
          </button>
        </div>
      </div>
    </div>
  );
}
