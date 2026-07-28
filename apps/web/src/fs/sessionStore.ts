import type { EditOp } from '@genealogy/core';
import type { ProjectSettings, SarChecklistState } from './project.js';
import {
  idbAvailable,
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  STORE_META,
  STORE_PROJECTS,
  STORE_SOURCES,
} from './idb.js';

// The browser-side session store: the copy of the user's work that restores
// instantly on load, with no folder permission and no user gesture. GEDCOM bytes
// are content-addressed in their own store so a 20 MB source is never rewritten
// alongside a one-line op on every autosave.

export interface SessionProjectRecord {
  name: string;
  /** sha256 hex of the GEDCOM bytes; the key into the sources store. */
  sourceHash: string;
  sourceFileName: string;
  focalPersonId: string | null;
  ops: EditOp[];
  checklists: SarChecklistState[];
  settings: ProjectSettings;
  createdAt: string;
  updatedAt: string;
}

export interface SessionStore {
  /** False when the browser gives us no durable storage; all calls become no-ops. */
  available(): boolean;

  putSource(hash: string, bytes: Uint8Array): Promise<void>;
  getSource(hash: string): Promise<Uint8Array | null>;
  hasSource(hash: string): Promise<boolean>;
  deleteSource(hash: string): Promise<void>;

  /** Returns false when the write did not land. */
  putProject(record: SessionProjectRecord): Promise<boolean>;
  getProject(name: string): Promise<SessionProjectRecord | null>;
  listProjects(): Promise<SessionProjectRecord[]>;
  deleteProject(name: string): Promise<void>;
  renameProject(from: string, to: string): Promise<SessionProjectRecord | null>;

  getLastProject(): Promise<string | null>;
  setLastProject(name: string | null): Promise<void>;
}

const LAST_PROJECT = 'lastProject';

export class IdbSessionStore implements SessionStore {
  available(): boolean {
    return idbAvailable();
  }

  async putSource(hash: string, bytes: Uint8Array): Promise<void> {
    await idbPut(STORE_SOURCES, hash, bytes);
  }

  async getSource(hash: string): Promise<Uint8Array | null> {
    const raw = await idbGet<ArrayBufferLike | Uint8Array>(STORE_SOURCES, hash);
    if (!raw) return null;
    return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  }

  async hasSource(hash: string): Promise<boolean> {
    return (await this.getSource(hash)) !== null;
  }

  async deleteSource(hash: string): Promise<void> {
    await idbDelete(STORE_SOURCES, hash);
  }

  async putProject(record: SessionProjectRecord): Promise<boolean> {
    return idbPut(STORE_PROJECTS, record.name, record);
  }

  async getProject(name: string): Promise<SessionProjectRecord | null> {
    return idbGet<SessionProjectRecord>(STORE_PROJECTS, name);
  }

  async listProjects(): Promise<SessionProjectRecord[]> {
    return idbGetAll<SessionProjectRecord>(STORE_PROJECTS);
  }

  async deleteProject(name: string): Promise<void> {
    await idbDelete(STORE_PROJECTS, name);
    if ((await this.getLastProject()) === name) await this.setLastProject(null);
  }

  async renameProject(from: string, to: string): Promise<SessionProjectRecord | null> {
    const record = await this.getProject(from);
    if (!record) return null;
    const renamed: SessionProjectRecord = { ...record, name: to };
    if (!(await this.putProject(renamed))) return null;
    await idbDelete(STORE_PROJECTS, from);
    if ((await this.getLastProject()) === from) await this.setLastProject(to);
    return renamed;
  }

  async getLastProject(): Promise<string | null> {
    return idbGet<string>(STORE_META, LAST_PROJECT);
  }

  async setLastProject(name: string | null): Promise<void> {
    if (name === null) await idbDelete(STORE_META, LAST_PROJECT);
    else await idbPut(STORE_META, LAST_PROJECT, name);
  }
}

/**
 * Ask the browser not to evict our IndexedDB data under storage pressure. Called
 * once when the first project is created. Safe no-op where unsupported.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = (navigator as { storage?: { persist?: () => Promise<boolean> } })
      .storage;
    if (!storage?.persist) return false;
    return await storage.persist();
  } catch {
    return false;
  }
}
