import type { SessionProjectRecord, SessionStore } from './sessionStore.js';

// In-memory SessionStore for tests, mirroring IdbSessionStore's behaviour exactly.
// jsdom has no IndexedDB, so this is how the session logic gets exercised -
// the same interface-plus-fake split fsa.ts/memfs.ts already uses for the
// File System Access API.

export class MemSessionStore implements SessionStore {
  private sources = new Map<string, Uint8Array>();
  private projects = new Map<string, SessionProjectRecord>();
  private last: string | null = null;
  /** Set true to simulate a browser with storage disabled. */
  failWrites = false;

  available(): boolean {
    return !this.failWrites;
  }

  async putSource(hash: string, bytes: Uint8Array): Promise<void> {
    if (this.failWrites) return;
    this.sources.set(hash, new Uint8Array(bytes));
  }

  async getSource(hash: string): Promise<Uint8Array | null> {
    return this.sources.get(hash) ?? null;
  }

  async hasSource(hash: string): Promise<boolean> {
    return this.sources.has(hash);
  }

  async deleteSource(hash: string): Promise<void> {
    this.sources.delete(hash);
  }

  async putProject(record: SessionProjectRecord): Promise<boolean> {
    if (this.failWrites) return false;
    this.projects.set(record.name, { ...record });
    return true;
  }

  async getProject(name: string): Promise<SessionProjectRecord | null> {
    const found = this.projects.get(name);
    return found ? { ...found } : null;
  }

  async listProjects(): Promise<SessionProjectRecord[]> {
    return [...this.projects.values()].map((r) => ({ ...r }));
  }

  async deleteProject(name: string): Promise<void> {
    this.projects.delete(name);
    if (this.last === name) this.last = null;
  }

  async renameProject(from: string, to: string): Promise<SessionProjectRecord | null> {
    const record = this.projects.get(from);
    if (!record) return null;
    const renamed: SessionProjectRecord = { ...record, name: to };
    this.projects.set(to, renamed);
    this.projects.delete(from);
    if (this.last === from) this.last = to;
    return { ...renamed };
  }

  async getLastProject(): Promise<string | null> {
    return this.last;
  }

  async setLastProject(name: string | null): Promise<void> {
    this.last = name;
  }
}
