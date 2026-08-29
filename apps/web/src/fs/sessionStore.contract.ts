import { describe, it, expect, beforeEach } from 'vitest';
import type { SessionProjectRecord, SessionStore } from './sessionStore.js';

export function makeRecord(
  partial: Partial<SessionProjectRecord> & { name: string; sourceHash: string },
): SessionProjectRecord {
  return {
    sourceFileName: `${partial.name}.ged`,
    focalPersonId: null,
    ops: [],
    checklists: [],
    settings: { orientation: 'vertical' },
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
    ...partial,
  };
}

/** Behavioural contract every SessionStore implementation must satisfy. */
export function runSessionStoreContract(name: string, make: () => SessionStore): void {
  describe(`SessionStore contract - ${name}`, () => {
    let store: SessionStore;
    beforeEach(() => {
      store = make();
    });

    it('round-trips source bytes by hash', async () => {
      const bytes = new TextEncoder().encode('0 HEAD\n0 TRLR\n');
      await store.putSource('abc123', bytes);
      expect(await store.hasSource('abc123')).toBe(true);
      expect(new TextDecoder().decode((await store.getSource('abc123'))!)).toContain(
        'HEAD',
      );
      expect(await store.getSource('missing')).toBeNull();
    });

    it('round-trips a project record including ops and settings', async () => {
      await store.putProject(
        makeRecord({
          name: 'tree',
          sourceHash: 'abc123',
          focalPersonId: 'I1',
          ops: [{ kind: 'editPerson', personId: 'I1', notes: ['x'], at: 't' }],
          settings: { orientation: 'horizontal' },
        }),
      );
      const back = await store.getProject('tree');
      expect(back!.focalPersonId).toBe('I1');
      expect(back!.ops).toHaveLength(1);
      expect(back!.settings.orientation).toBe('horizontal');
    });

    it('lists all projects', async () => {
      await store.putProject(makeRecord({ name: 'a', sourceHash: 'h1' }));
      await store.putProject(makeRecord({ name: 'b', sourceHash: 'h2' }));
      expect((await store.listProjects()).map((r) => r.name).sort()).toEqual([
        'a',
        'b',
      ]);
    });

    it('round-trips the last-project pointer and clears it', async () => {
      expect(await store.getLastProject()).toBeNull();
      await store.setLastProject('tree');
      expect(await store.getLastProject()).toBe('tree');
      await store.setLastProject(null);
      expect(await store.getLastProject()).toBeNull();
    });

    it('renames a project, moving the record and the pointer', async () => {
      await store.putProject(
        makeRecord({ name: 'old', sourceHash: 'h1', focalPersonId: 'I9' }),
      );
      await store.setLastProject('old');

      const renamed = await store.renameProject('old', 'new');
      expect(renamed!.name).toBe('new');
      expect(await store.getProject('old')).toBeNull();
      expect((await store.getProject('new'))!.focalPersonId).toBe('I9');
      expect(await store.getLastProject()).toBe('new');
    });

    it('returns null when renaming a project that does not exist', async () => {
      expect(await store.renameProject('ghost', 'new')).toBeNull();
    });

    it('clears the last-project pointer when that project is deleted', async () => {
      await store.putProject(makeRecord({ name: 'doomed', sourceHash: 'h1' }));
      await store.setLastProject('doomed');
      await store.deleteProject('doomed');
      expect(await store.getProject('doomed')).toBeNull();
      expect(await store.getLastProject()).toBeNull();
    });

    it('leaves the pointer alone when a different project is deleted', async () => {
      await store.putProject(makeRecord({ name: 'keep', sourceHash: 'h1' }));
      await store.putProject(makeRecord({ name: 'drop', sourceHash: 'h2' }));
      await store.setLastProject('keep');
      await store.deleteProject('drop');
      expect(await store.getLastProject()).toBe('keep');
    });
  });
}
