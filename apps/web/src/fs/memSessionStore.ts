import type { SessionProjectRecord, SessionStore } from './sessionStore.js';

// In-memory SessionStore for tests, mirroring IdbSessionStore's behaviour exactly.
// jsdom has no IndexedDB, so this is how the session logic gets exercised -
// the same interface-plus-fake split fsa.ts/memfs.ts already uses for the
// File System Access API.
//
// Two independent failure flags, mirroring two different real-world conditions:
// - `isAvailable` (default true): the browser gives us no durable storage at
//   all. `available()` reflects it, and every method becomes a no-op - reads
//   return null/[]/false, writes and deletes and renames do nothing - matching
//   IdbSessionStore when idbAvailable() is false. (Named `isAvailable` rather
//   than `available` because the interface already claims that identifier for
//   the method.)
// - `failWrites` (default false): storage exists but writes fail (e.g. quota
//   exceeded). Only the write paths fail: putSource does nothing, putProject
//   returns false, renameProject returns null. Reads still work, and
//   available() is unaffected.
//
// Every stored value is deep-copied on write and on read via structuredClone
// (the closest match to IndexedDB's own structured-clone semantics on
// put/get), and source bytes are copied with `new Uint8Array(...)`, so
// mutating a value returned from a getter can never corrupt stored state.

export class MemSessionStore implements SessionStore {
  private sources = new Map<string, Uint8Array>();
  private projects = new Map<string, SessionProjectRecord>();
  private last: string | null = null;
  /** Set false to simulate a browser with no durable storage at all. */
  isAvailable = true;
  /** Set true to simulate a browser whose storage exists but rejects writes. */
  failWrites = false;

  available(): boolean {
    return this.isAvailable;
  }

  async putSource(hash: string, bytes: Uint8Array): Promise<void> {
    if (!this.isAvailable || this.failWrites) return;
    this.sources.set(hash, new Uint8Array(bytes));
  }

  async getSource(hash: string): Promise<Uint8Array | null> {
    if (!this.isAvailable) return null;
    const stored = this.sources.get(hash);
    return stored ? new Uint8Array(stored) : null;
  }

  async hasSource(hash: string): Promise<boolean> {
    if (!this.isAvailable) return false;
    return this.sources.has(hash);
  }

  async deleteSource(hash: string): Promise<void> {
    if (!this.isAvailable) return;
    this.sources.delete(hash);
  }

  async putProject(record: SessionProjectRecord): Promise<boolean> {
    if (!this.isAvailable || this.failWrites) return false;
    this.projects.set(record.name, structuredClone(record));
    return true;
  }

  async getProject(name: string): Promise<SessionProjectRecord | null> {
    if (!this.isAvailable) return null;
    const found = this.projects.get(name);
    return found ? structuredClone(found) : null;
  }

  async listProjects(): Promise<SessionProjectRecord[]> {
    if (!this.isAvailable) return [];
    return [...this.projects.values()].map((r) => structuredClone(r));
  }

  async deleteProject(name: string): Promise<void> {
    if (!this.isAvailable) return;
    this.projects.delete(name);
    if (this.last === name) this.last = null;
  }

  async renameProject(from: string, to: string): Promise<SessionProjectRecord | null> {
    if (!this.isAvailable || this.failWrites) return null;
    const record = this.projects.get(from);
    if (!record) return null;
    const renamed: SessionProjectRecord = { ...record, name: to };
    this.projects.set(to, structuredClone(renamed));
    this.projects.delete(from);
    if (this.last === from) this.last = to;
    return structuredClone(renamed);
  }

  async getLastProject(): Promise<string | null> {
    if (!this.isAvailable) return null;
    return this.last;
  }

  async setLastProject(name: string | null): Promise<void> {
    if (!this.isAvailable) return;
    this.last = name;
  }
}
