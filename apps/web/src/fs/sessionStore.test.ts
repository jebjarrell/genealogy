import { describe, it, expect } from 'vitest';
import { MemSessionStore } from './memSessionStore.js';
import { makeRecord, runSessionStoreContract } from './sessionStore.contract.js';

// jsdom has no IndexedDB, so IdbSessionStore cannot run here. The contract is
// written against the interface so it can be pointed at the real implementation
// in a browser-based runner without changing an assertion.
runSessionStoreContract('MemSessionStore', () => new MemSessionStore());

// Fake-specific behaviour: clone isolation and the two failure flags are
// implementation details of MemSessionStore, not part of the interface
// contract, so they are asserted here rather than in sessionStore.contract.ts.
describe('MemSessionStore isolation and availability', () => {
  it('does not let a mutated returned project record corrupt stored state', async () => {
    const store = new MemSessionStore();
    await store.putProject(
      makeRecord({
        name: 'tree',
        sourceHash: 'h1',
        ops: [{ kind: 'editPerson', personId: 'I1', notes: ['a'], at: 't1' }],
      }),
    );

    const first = await store.getProject('tree');
    first!.ops.push({ kind: 'editPerson', personId: 'I2', notes: ['b'], at: 't2' });

    const second = await store.getProject('tree');
    expect(second!.ops).toHaveLength(1);
    expect(second!.ops[0]).toEqual({
      kind: 'editPerson',
      personId: 'I1',
      notes: ['a'],
      at: 't1',
    });
  });

  it('does not let a mutated returned source array corrupt stored bytes', async () => {
    const store = new MemSessionStore();
    const bytes = new Uint8Array([1, 2, 3]);
    await store.putSource('h1', bytes);

    const first = await store.getSource('h1');
    first![0] = 99;

    const second = await store.getSource('h1');
    expect(Array.from(second!)).toEqual([1, 2, 3]);
  });

  it('treats isAvailable = false as a full no-op', async () => {
    const store = new MemSessionStore();
    store.isAvailable = false;

    expect(store.available()).toBe(false);
    expect(await store.putProject(makeRecord({ name: 'tree', sourceHash: 'h1' }))).toBe(
      false,
    );
    expect(await store.getProject('tree')).toBeNull();
    expect(await store.renameProject('tree', 'renamed')).toBeNull();
  });

  it('treats failWrites = true as write-path failure only, leaving reads intact', async () => {
    const store = new MemSessionStore();
    await store.putProject(
      makeRecord({ name: 'tree', sourceHash: 'h1', focalPersonId: 'I1' }),
    );

    store.failWrites = true;
    expect(
      await store.putProject(makeRecord({ name: 'other', sourceHash: 'h2' })),
    ).toBe(false);
    expect(await store.renameProject('tree', 'renamed')).toBeNull();

    const stillThere = await store.getProject('tree');
    expect(stillThere!.focalPersonId).toBe('I1');
  });
});
