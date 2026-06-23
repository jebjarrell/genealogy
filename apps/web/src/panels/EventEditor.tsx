import { useEffect, useState } from 'react';
import type { EventType } from '@genealogy/core';
import { useStore } from '../state/store.js';
import { useEditorStore } from '../state/editorStore.js';

// Add/edit an event (handoff §3). Date and place are entered as raw GEDCOM-style
// strings and round-trip through the same parsers the importer uses, so the full
// date-qualifier set (ABT/BEF/AFT/EST/CAL/BET…AND, partial, double-dated) and the
// normalized place parts behave identically to imported data.

const EVENT_TYPES: EventType[] = [
  'birth',
  'death',
  'marriage',
  'burial',
  'baptism',
  'census',
  'residence',
  'immigration',
  'emigration',
  'military',
  'occupation',
  'other',
];

export function EventEditor() {
  const state = useEditorStore((s) => s.event);
  const close = useEditorStore((s) => s.closeEvent);
  const model = useStore((s) => s.model);
  const addEvent = useStore((s) => s.addEvent);
  const editEvent = useStore((s) => s.editEvent);

  const [eventType, setEventType] = useState<EventType>('birth');
  const [dateRaw, setDateRaw] = useState('');
  const [placeRaw, setPlaceRaw] = useState('');
  const [description, setDescription] = useState('');

  const editingId = state?.eventId;

  useEffect(() => {
    if (!state) return;
    if (state.eventId && model) {
      const ev = model.events.get(state.eventId);
      if (ev) {
        setEventType(ev.type);
        setDateRaw(ev.date?.raw ?? '');
        setPlaceRaw(ev.place?.raw ?? '');
        setDescription(ev.description ?? '');
        return;
      }
    }
    setEventType('birth');
    setDateRaw('');
    setPlaceRaw('');
    setDescription('');
  }, [state, model]);

  if (!state || !model) return null;

  const save = () => {
    if (editingId) {
      editEvent(editingId, {
        eventType,
        dateRaw: dateRaw.trim() ? dateRaw.trim() : null,
        placeRaw: placeRaw.trim() ? placeRaw.trim() : null,
        description: description.trim() ? description.trim() : null,
      });
    } else {
      addEvent({
        eventType,
        participantIds: [state.personId],
        ...(dateRaw.trim() ? { dateRaw: dateRaw.trim() } : {}),
        ...(placeRaw.trim() ? { placeRaw: placeRaw.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
    }
    close();
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="border-b border-gray-200 p-3">
          <h2 className="text-base font-bold text-gray-900">
            {editingId ? 'Edit event' : 'Add event'}
          </h2>
        </div>

        <div className="space-y-3 p-3">
          <label className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Type
            </span>
            <select
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 capitalize"
              value={eventType}
              onChange={(e) => setEventType(e.target.value as EventType)}
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Date
            </span>
            <input
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1"
              value={dateRaw}
              onChange={(e) => setDateRaw(e.target.value)}
              placeholder="e.g. 4 JUL 1776, ABT 1798, BET 1800 AND 1805"
            />
            <span className="text-[11px] text-gray-400">
              GEDCOM style — qualifiers ABT/BEF/AFT/EST/CAL and ranges are kept.
            </span>
          </label>

          <label className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Place
            </span>
            <input
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1"
              value={placeRaw}
              onChange={(e) => setPlaceRaw(e.target.value)}
              placeholder="City, County, State, Country"
            />
            <span className="text-[11px] text-gray-400">
              Comma-separated, most specific first.
            </span>
          </label>

          <label className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Description (optional)
            </span>
            <input
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
            className="rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700"
            onClick={save}
          >
            {editingId ? 'Save event' : 'Add event'}
          </button>
        </div>
      </div>
    </div>
  );
}
