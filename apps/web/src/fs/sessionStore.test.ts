import { MemSessionStore } from './memSessionStore.js';
import { runSessionStoreContract } from './sessionStore.contract.js';

// jsdom has no IndexedDB, so IdbSessionStore cannot run here. The contract is
// written against the interface so it can be pointed at the real implementation
// in a browser-based runner without changing an assertion.
runSessionStoreContract('MemSessionStore', () => new MemSessionStore());
