# Project Persistence & Session Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reopening the app restores the most recently used GEDCOM project automatically, and every edit autosaves to both IndexedDB and the workspace folder without the user ever pressing Save.

**Architecture:** IndexedDB becomes the authoritative session store (GEDCOM bytes keyed by content hash, project records keyed by name, plus a `lastProject` pointer). The existing File System Access workspace folder becomes a best-effort mirror that syncs when connected and reports failure loudly when not. Every GEDCOM import auto-creates a named project, eliminating the current unnamed "quick mode" that could not survive a reload.

**Tech Stack:** TypeScript, React 18, Zustand 5, Vite 6, Vitest 3 + jsdom, File System Access API, IndexedDB, Web Crypto.

**Spec:** `docs/superpowers/specs/2026-07-27-project-persistence-design.md`

**Branch:** `feat/project-persistence` (already created, spec already committed)

## Global Constraints

- All commands run from the repo root `F:\genealogy` unless stated. Web tests: `pnpm --filter @genealogy/web test`.
- Package manager is **pnpm 10.33.0**. Do not add dependencies — the design deliberately avoids `fake-indexeddb` by using an in-memory fake, matching the existing `fsa.ts`/`memfs.ts` pattern.
- All new modules live in `apps/web/src`. Nothing here may leak into `@genealogy/core` — the core↔file seam is a stated architectural rule (`fs/fsa.ts:1-8`).
- Import paths inside `apps/web/src` use explicit `.js` extensions (ESM + `moduleResolution` requires it), e.g. `import { X } from './y.js'`.
- Tests use Vitest globals imported explicitly: `import { describe, it, expect, beforeEach } from 'vitest'`.
- jsdom has **no** IndexedDB and **no** File System Access API. Every module touching them must guard with `typeof indexedDB !== 'undefined'` and degrade to a no-op, exactly as `fs/handleStore.ts:10-12` already does.
- The IndexedDB database is named `genealogy-graph`. It is currently **version 1** with a single `handles` store. This work moves it to **version 2**. Only `fs/idb.ts` may name the version.
- Legacy `localStorage` keys to remove: **exactly** `genealogy:focal:*`, `genealogy:ops:*`, `genealogy:aux:*`. **Do not touch `genealogy:placeCache`** — that is the geocoding cache owned by `geo/resolver.ts:20` and wiping it costs the user their resolved place lookups. Do not touch `ui:*` keys either (panel layout, `App.tsx:26-44`).
- Project names become **Windows directory names**. Sanitization is mandatory, not optional.
- Prettier config is at `.prettierrc`; run `pnpm format` before committing if formatting drifts.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `apps/web/src/fs/idb.ts` | Sole owner of the IndexedDB name/version/schema + typed request helpers |
| `apps/web/src/fs/sessionStore.ts` | `SessionStore` interface, record types, and the IndexedDB implementation |
| `apps/web/src/fs/memSessionStore.ts` | In-memory `SessionStore` for tests |
| `apps/web/src/fs/sessionStore.contract.ts` | Shared contract suite runnable against any `SessionStore` |
| `apps/web/src/fs/sessionStore.test.ts` | Runs the contract against `MemSessionStore` |
| `apps/web/src/fs/projectName.ts` | Filename → safe, unique project name |
| `apps/web/src/fs/projectName.test.ts` | Sanitize + uniquify tests |
| `apps/web/src/state/persistence.ts` | Debounce, flush, dual-write, in-flight locking, save status |
| `apps/web/src/state/persistence.test.ts` | Scheduler behaviour tests |

**Modify:**

| File | Change |
|---|---|
| `apps/web/src/fs/handleStore.ts` | Delegate DB opening to `idb.ts` |
| `apps/web/src/fs/fsa.ts` | Split `ensurePermission` into `hasPermission` (query-only) / `requestPermissionInteractive` |
| `apps/web/src/fs/project.ts` | Add `sourceHash` to `ProjectFile` + `parseProject` + `newProject` |
| `apps/web/src/fs/workspace.ts` | Accept `sourceHash` on create; add `listProjectSummaries()` |
| `apps/web/src/state/store.ts` | `importGedcom`, `restoreSession`, save-state slice, folder mirror/backfill; remove localStorage persistence |
| `apps/web/src/App.tsx` | Boot via `restoreSession`; save indicator; folder-failure banner |
| `apps/web/src/panels/WorkspaceModal.tsx` | Remove "Save current file as a project"; add Reconnect |
| `apps/web/src/upload/UploadButton.tsx` | Route both buttons through `importGedcom` |
| `apps/web/src/state/store.test.ts` | Replace localStorage focal assertions |
| `apps/web/src/state/merge.test.ts` | Replace localStorage ops assertions |

**Key decision:** `loadModel` is **kept** as the synchronous in-memory primitive (8 test files call it). Its localStorage side effects are stripped; `importGedcom` and `restoreSession` both call it and then layer persistence on top. This avoids rewriting `FamilyPanel.test.tsx`, `LocalityReport.test.tsx`, `PersonEditor.test.tsx`, `ReviewPanel.test.tsx`, `SarPanel.test.tsx`, and `edit.test.ts`.

---

## Task 1: Safe project names

**Files:**
- Create: `apps/web/src/fs/projectName.ts`
- Test: `apps/web/src/fs/projectName.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `sanitizeProjectName(input: string): string`
  - `uniqueProjectName(base: string, existing: Iterable<string>): string`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/fs/projectName.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sanitizeProjectName, uniqueProjectName } from './projectName.js';

describe('sanitizeProjectName', () => {
  it('strips a .ged/.gedcom extension', () => {
    expect(sanitizeProjectName('jarrell-tree.ged')).toBe('jarrell-tree');
    expect(sanitizeProjectName('jarrell-tree.GEDCOM')).toBe('jarrell-tree');
  });

  it('removes characters illegal in Windows directory names', () => {
    expect(sanitizeProjectName('M*A*S*H.ged')).toBe('M A S H');
    expect(sanitizeProjectName('a/b\\c:d?e"f<g>h|i')).toBe('a b c d e f g h i');
  });

  it('collapses whitespace and trims trailing dots and spaces', () => {
    expect(sanitizeProjectName('  spaced   out  ')).toBe('spaced out');
    expect(sanitizeProjectName('trailing...')).toBe('trailing');
  });

  it('defuses Windows reserved device names, with or without extension', () => {
    expect(sanitizeProjectName('CON.ged')).toBe('CON (project)');
    expect(sanitizeProjectName('nul')).toBe('nul (project)');
    expect(sanitizeProjectName('COM4.txt')).toBe('COM4.txt (project)');
  });

  it('caps length at 100 characters', () => {
    expect(sanitizeProjectName('x'.repeat(250))).toHaveLength(100);
  });

  it('falls back to Untitled when nothing usable remains', () => {
    expect(sanitizeProjectName('')).toBe('Untitled');
    expect(sanitizeProjectName('///')).toBe('Untitled');
    expect(sanitizeProjectName('.ged')).toBe('Untitled');
  });
});

describe('uniqueProjectName', () => {
  it('returns the base name when it is free', () => {
    expect(uniqueProjectName('tree', [])).toBe('tree');
  });

  it('appends an incrementing suffix when taken', () => {
    expect(uniqueProjectName('tree', ['tree'])).toBe('tree (2)');
    expect(uniqueProjectName('tree', ['tree', 'tree (2)'])).toBe('tree (3)');
  });

  it('compares case-insensitively, since Windows folders are', () => {
    expect(uniqueProjectName('Tree', ['tree'])).toBe('Tree (2)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @genealogy/web test -- projectName`
Expected: FAIL — cannot resolve `./projectName.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/fs/projectName.ts`:

```ts
// A project is a folder on disk, so its name must be a legal directory name on
// Windows as well as POSIX. Anything the user's filename throws at us gets
// reduced to something `getDirectoryHandle` will accept — otherwise the create
// throws and is swallowed by RealDir.getDir's catch, silently yielding no project.

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_LENGTH = 100;

export function sanitizeProjectName(input: string): string {
  let name = input.replace(/\.(ged|gedcom)$/i, '');
  name = name.replace(ILLEGAL, ' ');
  name = name.replace(/\s+/g, ' ').trim();
  name = name.replace(/[. ]+$/, '');
  if (name.length > MAX_LENGTH) name = name.slice(0, MAX_LENGTH).trim();
  // Windows reserves these regardless of extension: CON.txt is as illegal as CON.
  const stem = name.split('.')[0] ?? '';
  if (RESERVED.test(stem)) name = `${name} (project)`;
  return name === '' ? 'Untitled' : name;
}

/** First free name in the series `base`, `base (2)`, `base (3)`, … */
export function uniqueProjectName(base: string, existing: Iterable<string>): string {
  const taken = new Set([...existing].map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @genealogy/web test -- projectName`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/fs/projectName.ts apps/web/src/fs/projectName.test.ts
git commit -m "feat(fs): derive safe, unique project names from filenames"
```

---

## Task 2: Shared IndexedDB owner

**Files:**
- Create: `apps/web/src/fs/idb.ts`
- Modify: `apps/web/src/fs/handleStore.ts` (replace its private `openDb`, lines 6-22)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `idbAvailable(): boolean`
  - `STORE_HANDLES`, `STORE_SOURCES`, `STORE_PROJECTS`, `STORE_META` — string constants
  - `idbGet<T>(store: string, key: string): Promise<T | null>`
  - `idbGetAll<T>(store: string): Promise<T[]>`
  - `idbPut(store: string, key: string, value: unknown): Promise<boolean>` — `false` signals a failed write
  - `idbDelete(store: string, key: string): Promise<void>`

There is no automated test for this task: jsdom provides no IndexedDB, and the codebase already accepts that for `handleStore.ts` (see its header comment). Correctness is enforced by Task 3's contract suite running against the in-memory fake, plus the manual check in Step 3 below.

- [ ] **Step 1: Write the module**

Create `apps/web/src/fs/idb.ts`:

```ts
// Sole owner of the app's IndexedDB database name, version, and schema.
//
// Two modules opening the same database at different versions block each other,
// so the version number lives here and nowhere else. Everything is guarded so it
// is a safe no-op where IndexedDB is unavailable (e.g. the jsdom test env, or a
// browser in private mode with storage disabled).

const DB_NAME = 'genealogy-graph';
const DB_VERSION = 2;

export const STORE_HANDLES = 'handles';
export const STORE_SOURCES = 'sources';
export const STORE_PROJECTS = 'projects';
export const STORE_META = 'meta';

const ALL_STORES = [STORE_HANDLES, STORE_SOURCES, STORE_PROJECTS, STORE_META];

export function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!idbAvailable()) return resolve(null);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // v1 shipped with only `handles`; creating conditionally makes the upgrade
      // idempotent and safe from any prior version.
      for (const name of ALL_STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

export async function idbGet<T>(store: string, key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  const result = await new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  db.close();
  return result;
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  if (!db) return [];
  const result = await new Promise<T[]>((resolve) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve((req.result as T[] | undefined) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
  db.close();
  return result;
}

/** Returns false when the write did not land, so callers can report it. */
export async function idbPut(
  store: string,
  key: string,
  value: unknown,
): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  const ok = await new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
  db.close();
  return ok;
}

export async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}
```

- [ ] **Step 2: Rewrite `handleStore.ts` on top of it**

Replace the entire contents of `apps/web/src/fs/handleStore.ts`:

```ts
// Persist the workspace directory HANDLE (not its contents) so the binding to a
// real folder survives reloads (handoff §2). IndexedDB is the only place the
// File System Access API allows a handle to be stored. Schema and version live
// in idb.ts, which is the single owner of the database.

import { idbDelete, idbGet, idbPut, STORE_HANDLES } from './idb.js';

const KEY = 'workspace-root';

export async function saveHandle(handle: unknown): Promise<void> {
  await idbPut(STORE_HANDLES, KEY, handle);
}

export async function loadHandle(): Promise<unknown | null> {
  return idbGet<unknown>(STORE_HANDLES, KEY);
}

export async function clearHandle(): Promise<void> {
  await idbDelete(STORE_HANDLES, KEY);
}
```

- [ ] **Step 3: Verify nothing regressed**

Run: `pnpm --filter @genealogy/web typecheck && pnpm --filter @genealogy/web test`
Expected: typecheck clean; the full existing suite still passes (no test exercises IndexedDB, so this is a no-regression check).

Then a one-time manual confirmation that the schema upgrade works in a real browser — the only place it can be observed:

```
pnpm dev
# open the app, DevTools → Application → IndexedDB → genealogy-graph
# confirm: version 2, and four object stores (handles, sources, projects, meta)
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/fs/idb.ts apps/web/src/fs/handleStore.ts
git commit -m "refactor(fs): centralize IndexedDB schema in idb.ts and bump to v2"
```

---

## Task 3: Session store — interface, fake, and contract

**Files:**
- Create: `apps/web/src/fs/sessionStore.ts`
- Create: `apps/web/src/fs/memSessionStore.ts`
- Create: `apps/web/src/fs/sessionStore.contract.ts`
- Test: `apps/web/src/fs/sessionStore.test.ts`

**Interfaces:**
- Consumes: `idb.ts` helpers and store constants (Task 2)
- Produces:
  - `interface SessionProjectRecord { name; sourceHash; sourceFileName; focalPersonId; ops; checklists; settings; createdAt; updatedAt }`
  - `interface SessionStore` with `available()`, `putSource`, `getSource`, `hasSource`, `deleteSource`, `putProject`, `getProject`, `listProjects`, `deleteProject`, `renameProject`, `getLastProject`, `setLastProject`
  - `class IdbSessionStore implements SessionStore`
  - `class MemSessionStore implements SessionStore`
  - `runSessionStoreContract(name: string, make: () => SessionStore): void`

- [ ] **Step 1: Write the interface and the IndexedDB implementation**

Create `apps/web/src/fs/sessionStore.ts`:

```ts
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
```

- [ ] **Step 2: Write the in-memory fake**

Create `apps/web/src/fs/memSessionStore.ts`:

```ts
import type { SessionProjectRecord, SessionStore } from './sessionStore.js';

// In-memory SessionStore for tests, mirroring IdbSessionStore's behaviour exactly.
// jsdom has no IndexedDB, so this is how the session logic gets exercised —
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
```

- [ ] **Step 3: Write the contract suite**

Create `apps/web/src/fs/sessionStore.contract.ts`. Keeping this separate from the test file means the identical suite can later be pointed at `IdbSessionStore` (under a real browser or `fake-indexeddb`) without duplicating a single assertion:

```ts
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
  describe(`SessionStore contract — ${name}`, () => {
    let store: SessionStore;
    beforeEach(() => {
      store = make();
    });

    it('round-trips source bytes by hash', async () => {
      const bytes = new TextEncoder().encode('0 HEAD\n0 TRLR\n');
      await store.putSource('abc123', bytes);
      expect(await store.hasSource('abc123')).toBe(true);
      expect(new TextDecoder().decode((await store.getSource('abc123'))!)).toContain('HEAD');
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
      expect((await store.listProjects()).map((r) => r.name).sort()).toEqual(['a', 'b']);
    });

    it('round-trips the last-project pointer and clears it', async () => {
      expect(await store.getLastProject()).toBeNull();
      await store.setLastProject('tree');
      expect(await store.getLastProject()).toBe('tree');
      await store.setLastProject(null);
      expect(await store.getLastProject()).toBeNull();
    });

    it('renames a project, moving the record and the pointer', async () => {
      await store.putProject(makeRecord({ name: 'old', sourceHash: 'h1', focalPersonId: 'I9' }));
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
```

- [ ] **Step 4: Run the contract against the fake**

Create `apps/web/src/fs/sessionStore.test.ts`:

```ts
import { MemSessionStore } from './memSessionStore.js';
import { runSessionStoreContract } from './sessionStore.contract.js';

// jsdom has no IndexedDB, so IdbSessionStore cannot run here. The contract is
// written against the interface so it can be pointed at the real implementation
// in a browser-based runner without changing an assertion.
runSessionStoreContract('MemSessionStore', () => new MemSessionStore());
```

Run: `pnpm --filter @genealogy/web test -- sessionStore`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/fs/sessionStore.ts apps/web/src/fs/memSessionStore.ts \
        apps/web/src/fs/sessionStore.contract.ts apps/web/src/fs/sessionStore.test.ts
git commit -m "feat(fs): add SessionStore with IndexedDB impl, in-memory fake, and contract suite"
```

---

## Task 4: Content hash on folder projects

**Files:**
- Modify: `apps/web/src/fs/project.ts` (`ProjectFile` at :25-39, `newProject` at :44-61, `parseProject` at :72-100)
- Modify: `apps/web/src/fs/workspace.ts` (`createProject` at :76-92, add `listProjectSummaries`)
- Test: `apps/web/src/fs/workspace.test.ts` (append)

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `ProjectFile.sourceHash: string` (empty string when unknown)
  - `newProject(name, sourceFileName, sourceFile?, sourceHash?): ProjectFile`
  - `Workspace.createProject(name, gedcomBytes, sourceFileName, sourceHash?): Promise<ProjectFile>`
  - `Workspace.listProjectSummaries(): Promise<{ name: string; sourceHash: string }[]>`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/fs/workspace.test.ts`:

```ts
describe('Workspace — source hashing for import matching', () => {
  it('stores a sourceHash on create and reports it in summaries', async () => {
    const ws = new Workspace(new MemDir());
    await ws.createProject('Hashed', GED, 'h.ged', 'deadbeef');
    expect((await ws.openProject('Hashed'))!.project.sourceHash).toBe('deadbeef');
    expect(await ws.listProjectSummaries()).toEqual([
      { name: 'Hashed', sourceHash: 'deadbeef' },
    ]);
  });

  it('defaults sourceHash to empty string for projects written before this field', () => {
    const legacy = JSON.stringify({
      format: 'genealogy-graph/project',
      version: 1,
      name: 'Old',
      sourceFile: 'source.ged',
      sourceFileName: 'old.ged',
    });
    expect(parseProject(legacy)!.sourceHash).toBe('');
  });

  it('skips unreadable project folders when summarizing', async () => {
    const ws = new Workspace(new MemDir());
    await ws.createProject('Good', GED, 'g.ged', 'aaa');
    // A folder with no project.json — e.g. one the user created by hand.
    const projects = await ws.root.getDir('projects', true);
    await projects!.getDir('Empty', true);
    expect(await ws.listProjectSummaries()).toEqual([{ name: 'Good', sourceHash: 'aaa' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @genealogy/web test -- workspace`
Expected: FAIL — `createProject` takes 3 arguments; `listProjectSummaries` is not a function.

- [ ] **Step 3: Add `sourceHash` to the project record**

In `apps/web/src/fs/project.ts`, add the field to the `ProjectFile` interface after `sourceFileName` (line 31):

```ts
  /** The original upload filename, for display and export naming. */
  sourceFileName: string;
  /** sha256 hex of the GEDCOM bytes; '' for projects written before this field. */
  sourceHash: string;
```

Change `newProject` to accept and set it:

```ts
export function newProject(
  name: string,
  sourceFileName: string,
  sourceFile = 'source.ged',
  sourceHash = '',
): ProjectFile {
  return {
    format: 'genealogy-graph/project',
    version: 1,
    name,
    sourceFile,
    sourceFileName,
    sourceHash,
    focalPersonId: null,
    ops: [],
    checklists: [],
    settings: { ...DEFAULT_SETTINGS },
    updatedAt: new Date().toISOString(),
  };
}
```

In `parseProject`, add one line to the returned object, after the `sourceFileName` entry:

```ts
    sourceHash: typeof r.sourceHash === 'string' ? r.sourceHash : '',
```

- [ ] **Step 4: Thread it through `Workspace`**

In `apps/web/src/fs/workspace.ts`, change `createProject`'s signature and its `newProject` call:

```ts
  async createProject(
    name: string,
    gedcomBytes: Uint8Array,
    sourceFileName: string,
    sourceHash = '',
  ): Promise<ProjectFile> {
    const parent = await this.projectsDir(true);
    if (!parent) throw new Error('Cannot open the projects folder.');
    const dir = await parent.getDir(name, true);
    if (!dir) throw new Error(`Cannot create project "${name}".`);

    const source = await dir.getFile(SOURCE_GED, true);
    if (source) await source.write(gedcomBytes);

    const project = newProject(name, sourceFileName, SOURCE_GED, sourceHash);
    await this.writeProjectFile(dir, project);
    return project;
  }
```

Add this method immediately after `hasProject` (line 64), so import matching does not have to read and re-hash every `source.ged`:

```ts
  /**
   * Name + content hash for every project on disk. Used to match an imported
   * GEDCOM against existing folder projects without reading their sources.
   * Folders without a readable project.json are skipped rather than failing
   * the whole listing.
   */
  async listProjectSummaries(): Promise<{ name: string; sourceHash: string }[]> {
    const out: { name: string; sourceHash: string }[] = [];
    const parent = await this.projectsDir(false);
    if (!parent) return out;
    for (const name of await this.listProjects()) {
      const dir = await parent.getDir(name, false);
      const file = dir ? await dir.getFile(PROJECT_JSON, false) : null;
      if (!file) continue;
      const project = parseProject(await file.readText());
      if (project) out.push({ name, sourceHash: project.sourceHash });
    }
    return out;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @genealogy/web test -- workspace && pnpm --filter @genealogy/web typecheck`
Expected: PASS. Note the pre-existing workspace tests still pass because `sourceHash` defaults to `''`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/fs/project.ts apps/web/src/fs/workspace.ts apps/web/src/fs/workspace.test.ts
git commit -m "feat(fs): record a GEDCOM content hash on folder projects for import matching"
```

---

## Task 5: Boot-safe permission checks

**Files:**
- Modify: `apps/web/src/fs/fsa.ts` (`ensurePermission` at :124-139)
- Modify: `apps/web/src/state/store.ts` (`connectWorkspace` at :761, `restoreWorkspace` at :779)

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `hasPermission(handle: unknown): Promise<boolean>` — query only, safe to call on page load
  - `requestPermissionInteractive(handle: unknown): Promise<boolean>` — query then request; must be called from a user gesture

This is the fix for the silently-failing folder rebind: `requestPermission()` requires transient user activation, so calling it during boot can never succeed.

- [ ] **Step 1: Replace `ensurePermission` in `fsa.ts`**

Replace lines 124-139 of `apps/web/src/fs/fsa.ts`:

```ts
/**
 * Query an existing permission grant WITHOUT prompting. Safe to call on page
 * load: `requestPermission()` requires transient user activation, so prompting
 * during boot can never succeed and merely fails silently.
 */
export async function hasPermission(handle: unknown): Promise<boolean> {
  const h = handle as PermissionedHandle;
  try {
    if (!h.queryPermission) return false;
    return (await h.queryPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Ensure read/write permission, prompting if needed. MUST be called from within
 * a user gesture (a click handler) or the prompt will be suppressed.
 */
export async function requestPermissionInteractive(handle: unknown): Promise<boolean> {
  const h = handle as PermissionedHandle;
  const opts = { mode: 'readwrite' as const };
  try {
    if (h.queryPermission && (await h.queryPermission(opts)) === 'granted') return true;
    if (h.requestPermission && (await h.requestPermission(opts)) === 'granted') return true;
  } catch {
    return false;
  }
  return false;
}
```

- [ ] **Step 2: Update the two call sites in `store.ts`**

Change the import on line 25:

```ts
import {
  dirFromHandle,
  hasPermission,
  requestPermissionInteractive,
  pickDirectory,
} from '../fs/fsa.js';
```

In `connectWorkspace` (line 764) — this runs from a click, so it prompts:

```ts
      if (!(await requestPermissionInteractive(handle))) {
```

In `restoreWorkspace` (line 782) — this runs on boot, so it must only query. Replace the body:

```ts
    restoreWorkspace: async () => {
      const handle = await loadHandle();
      if (!handle) {
        set({ folderStatus: 'none' });
        return;
      }
      if (!(await hasPermission(handle))) {
        // The grant lapsed. Surface a Reconnect control rather than failing mute;
        // re-granting needs a user gesture we do not have here.
        set({ folderStatus: 'needs-permission' });
        return;
      }
      const ws = new Workspace(dirFromHandle(handle));
      set({
        workspace: ws,
        workspaceName: (handle as { name?: string }).name ?? 'workspace',
        folderStatus: 'connected',
      });
      await get().refreshProjects();
      await get().refreshVault();
    },
```

Add a `reconnectWorkspace` action next to it, for the Reconnect button (Task 9 renders it):

```ts
    /** Re-grant permission to the remembered folder. Must be called from a click. */
    reconnectWorkspace: async () => {
      const handle = await loadHandle();
      if (!handle) {
        await get().connectWorkspace();
        return;
      }
      if (!(await requestPermissionInteractive(handle))) {
        set({ folderStatus: 'needs-permission', notice: 'Folder permission was denied.' });
        return;
      }
      const ws = new Workspace(dirFromHandle(handle));
      set({
        workspace: ws,
        workspaceName: (handle as { name?: string }).name ?? 'workspace',
        folderStatus: 'connected',
        notice: 'Workspace reconnected.',
      });
      await get().refreshProjects();
      await get().refreshVault();
      await get().backfillFolder();
    },
```

`folderStatus` and `backfillFolder` do not exist yet — they arrive in Tasks 6 and 8. Until then this task will not typecheck on its own; that is expected and is why Steps 3-4 defer verification. Add the two declarations to `AppState` now so the file stays coherent, in the `persistence / workspace` block (after line 252):

```ts
  folderStatus: FolderStatus;
  reconnectWorkspace: () => Promise<void>;
  backfillFolder: () => Promise<void>;
```

with `folderStatus: 'none'` added to the initial state (after line 467), a stub `backfillFolder: async () => {}` (replaced in Task 8), and this import added:

```ts
import type { FolderStatus } from './persistence.js';
```

`persistence.ts` is created in Task 6. **Implement Task 6 before typechecking this one** — or, if working strictly task-by-task, temporarily declare `type FolderStatus = 'none' | 'connected' | 'needs-permission' | 'error';` locally in `store.ts` and delete it when Task 6 lands.

- [ ] **Step 3: Verify no remaining references to the old name**

Run: `grep -rn "ensurePermission" apps/web/src`
Expected: no output.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @genealogy/web test`
Expected: PASS — no existing test exercises permissions (jsdom has no FSA API), so this is a no-regression check.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/fs/fsa.ts apps/web/src/state/store.ts
git commit -m "fix(fs): never prompt for folder permission during boot"
```

---

## Task 6: The save scheduler

**Files:**
- Create: `apps/web/src/state/persistence.ts`
- Test: `apps/web/src/state/persistence.test.ts`

**Interfaces:**
- Consumes: `SessionStore`, `SessionProjectRecord` (Task 3); `Workspace` (existing)
- Produces:
  - `type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'`
  - `type FolderStatus = 'none' | 'connected' | 'needs-permission' | 'error'`
  - `class Debounced { schedule(): void; fire(): Promise<void>; get pending(): boolean }`
  - `interface SaveSnapshot { record: SessionProjectRecord; sourceBytes: Uint8Array | null }`
  - `class SaveScheduler { schedule(): void; flush(): Promise<void>; dispose(): void }`
  - `SESSION_DEBOUNCE_MS = 300`, `FOLDER_DEBOUNCE_MS = 1000`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/state/persistence.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Debounced, SaveScheduler, type SaveSnapshot } from './persistence.js';
import { MemSessionStore } from '../fs/memSessionStore.js';
import { makeRecord } from '../fs/sessionStore.contract.js';
import { Workspace } from '../fs/workspace.js';
import { MemDir } from '../fs/memfs.js';

const GED = new TextEncoder().encode('0 HEAD\n0 @I1@ INDI\n0 TRLR\n');

describe('Debounced', () => {
  beforeEach(() => vi.useFakeTimers());

  it('coalesces repeated schedules into a single run', async () => {
    const run = vi.fn(async () => {});
    const d = new Debounced(300, run);
    d.schedule();
    d.schedule();
    d.schedule();
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('fire() runs immediately and cancels the pending timer', async () => {
    const run = vi.fn(async () => {});
    const d = new Debounced(300, run);
    d.schedule();
    expect(d.pending).toBe(true);
    await d.fire();
    expect(run).toHaveBeenCalledTimes(1);
    expect(d.pending).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1); // the timer did not also fire
  });

  it('serializes overlapping runs and re-runs once for work queued mid-flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = vi.fn(async () => {
      if (run.mock.calls.length === 1) await gate;
    });
    const d = new Debounced(300, run);

    const first = d.fire();
    const second = d.fire(); // arrives while the first is still running
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(run).toHaveBeenCalledTimes(2); // exactly one catch-up run, not two
  });
});

describe('SaveScheduler', () => {
  let session: MemSessionStore;
  let workspace: Workspace;
  let snapshot: SaveSnapshot;

  beforeEach(() => {
    vi.useFakeTimers();
    session = new MemSessionStore();
    workspace = new Workspace(new MemDir());
    snapshot = {
      record: makeRecord({ name: 'tree', sourceHash: 'h1' }),
      sourceBytes: GED,
    };
  });

  const make = (over: Partial<ConstructorParameters<typeof SaveScheduler>[0]> = {}) => {
    const states: string[] = [];
    const folders: string[] = [];
    const scheduler = new SaveScheduler({
      snapshot: () => snapshot,
      session: () => session,
      workspace: () => workspace,
      onSaveState: (status) => states.push(status),
      onFolderState: (status) => folders.push(status),
      ...over,
    });
    return { scheduler, states, folders };
  };

  it('writes the project record and source to the session store', async () => {
    const { scheduler, states } = make();
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(300);

    expect((await session.getProject('tree'))!.sourceHash).toBe('h1');
    expect(await session.hasSource('h1')).toBe(true);
    expect(await session.getLastProject()).toBe('tree');
    expect(states).toContain('saving');
    expect(states).toContain('saved');
  });

  it('writes the source bytes only once across repeated saves', async () => {
    const { scheduler } = make();
    const spy = vi.spyOn(session, 'putSource');
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(300);
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('mirrors to the workspace folder on the slower interval', async () => {
    const { scheduler, folders } = make();
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(await workspace.listProjects()).toEqual([]); // folder write not due yet
    await vi.advanceTimersByTimeAsync(700);
    expect(await workspace.listProjects()).toEqual(['tree']);
    expect(folders).toContain('connected');
  });

  it('flush() writes both targets immediately', async () => {
    const { scheduler } = make();
    scheduler.schedule();
    await scheduler.flush();
    expect(await session.getProject('tree')).not.toBeNull();
    expect(await workspace.listProjects()).toEqual(['tree']);
  });

  it('reports a folder failure but still saves to the session store', async () => {
    const { scheduler, states, folders } = make();
    vi.spyOn(workspace, 'saveProject').mockRejectedValue(new Error('drive gone'));
    scheduler.schedule();
    await scheduler.flush();

    expect(await session.getProject('tree')).not.toBeNull(); // browser copy is safe
    expect(folders).toContain('error');
    expect(states).not.toContain('error'); // the authoritative write succeeded
  });

  it('reports an error when the session write fails', async () => {
    session.failWrites = true;
    const { scheduler, states } = make();
    scheduler.schedule();
    await scheduler.flush();
    expect(states).toContain('error');
  });

  it('does nothing when there is no snapshot to save', async () => {
    const { scheduler, states } = make({ snapshot: () => null });
    scheduler.schedule();
    await scheduler.flush();
    expect(await session.listProjects()).toEqual([]);
    expect(states).not.toContain('saved');
  });

  it('skips the folder write when no workspace is connected', async () => {
    const { scheduler, folders } = make({ workspace: () => null });
    scheduler.schedule();
    await scheduler.flush();
    expect(await session.getProject('tree')).not.toBeNull();
    expect(folders).not.toContain('error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @genealogy/web test -- persistence`
Expected: FAIL — cannot resolve `./persistence.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/state/persistence.ts`:

```ts
import type { SessionProjectRecord, SessionStore } from '../fs/sessionStore.js';
import type { Workspace } from '../fs/workspace.js';
import type { ProjectFile } from '../fs/project.js';

// Autosave orchestration, kept out of store.ts so the store stays about state
// and this stays about durability.
//
// Two targets with different costs and different guarantees:
//   session store (IndexedDB) — authoritative, fast, debounced 300ms
//   workspace folder          — best-effort mirror, slower, debounced 1s
// A failure of the first is reported as a save error; a failure of the second
// only marks the folder unavailable, because the user's work is still safe.

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type FolderStatus = 'none' | 'connected' | 'needs-permission' | 'error';

export const SESSION_DEBOUNCE_MS = 300;
export const FOLDER_DEBOUNCE_MS = 1000;

/**
 * A trailing-edge debounce whose runs never overlap. Work requested while a run
 * is in flight sets a dirty flag and triggers exactly one catch-up run, so a
 * burst of edits can never interleave two writes to the same record.
 */
export class Debounced {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private dirty = false;

  constructor(
    private readonly delayMs: number,
    private readonly run: () => Promise<void>,
  ) {}

  get pending(): boolean {
    return this.timer !== null;
  }

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.fire(), this.delayMs);
  }

  /** Run now, cancelling any pending timer. */
  async fire(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running) {
      this.dirty = true;
      return;
    }
    this.running = true;
    try {
      await this.run();
      while (this.dirty) {
        this.dirty = false;
        await this.run();
      }
    } finally {
      this.running = false;
    }
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export interface SaveSnapshot {
  record: SessionProjectRecord;
  /** Null when the source is already known to be stored. */
  sourceBytes: Uint8Array | null;
}

export interface SaveSchedulerOptions {
  /** Current state to persist; null when there is nothing open. */
  snapshot: () => SaveSnapshot | null;
  session: () => SessionStore | null;
  workspace: () => Workspace | null;
  onSaveState: (status: SaveStatus, at: string | null) => void;
  onFolderState: (status: FolderStatus) => void;
}

export class SaveScheduler {
  private readonly sessionSave: Debounced;
  private readonly folderSave: Debounced;
  /** Hashes already written this session, so a large GEDCOM is stored once. */
  private readonly storedSources = new Set<string>();

  constructor(private readonly opts: SaveSchedulerOptions) {
    this.sessionSave = new Debounced(SESSION_DEBOUNCE_MS, () => this.runSession());
    this.folderSave = new Debounced(FOLDER_DEBOUNCE_MS, () => this.runFolder());
  }

  schedule(): void {
    this.sessionSave.schedule();
    this.folderSave.schedule();
  }

  /** Write both targets now. Called on page hide and before switching projects. */
  async flush(): Promise<void> {
    await this.sessionSave.fire();
    await this.folderSave.fire();
  }

  dispose(): void {
    this.sessionSave.cancel();
    this.folderSave.cancel();
  }

  private async runSession(): Promise<void> {
    const snap = this.opts.snapshot();
    const session = this.opts.session();
    if (!snap || !session) return;

    this.opts.onSaveState('saving', null);
    try {
      if (snap.sourceBytes && !this.storedSources.has(snap.record.sourceHash)) {
        if (!(await session.hasSource(snap.record.sourceHash))) {
          await session.putSource(snap.record.sourceHash, snap.sourceBytes);
        }
        this.storedSources.add(snap.record.sourceHash);
      }
      const ok = await session.putProject({
        ...snap.record,
        updatedAt: new Date().toISOString(),
      });
      await session.setLastProject(snap.record.name);
      if (ok) this.opts.onSaveState('saved', new Date().toISOString());
      else this.opts.onSaveState('error', null);
    } catch {
      this.opts.onSaveState('error', null);
    }
  }

  private async runFolder(): Promise<void> {
    const snap = this.opts.snapshot();
    const workspace = this.opts.workspace();
    if (!snap || !workspace) return;

    try {
      const existing = await workspace.listProjects();
      if (!existing.includes(snap.record.name)) {
        if (!snap.sourceBytes) return; // cannot create the folder without a source
        await workspace.createProject(
          snap.record.name,
          snap.sourceBytes,
          snap.record.sourceFileName,
          snap.record.sourceHash,
        );
      }
      await workspace.saveProject(toProjectFile(snap.record));
      this.opts.onFolderState('connected');
    } catch {
      // Drive unplugged, permission revoked, folder deleted. The session store
      // still has the work, so this is a status change, not a save failure.
      this.opts.onFolderState('error');
    }
  }
}

/** Project record (browser shape) → project.json (disk shape). */
export function toProjectFile(record: SessionProjectRecord): ProjectFile {
  return {
    format: 'genealogy-graph/project',
    version: 1,
    name: record.name,
    sourceFile: 'source.ged',
    sourceFileName: record.sourceFileName,
    sourceHash: record.sourceHash,
    focalPersonId: record.focalPersonId,
    ops: record.ops,
    checklists: record.checklists,
    settings: record.settings,
    updatedAt: record.updatedAt,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @genealogy/web test -- persistence`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/state/persistence.ts apps/web/src/state/persistence.test.ts
git commit -m "feat(state): add debounced dual-target save scheduler with flush and status"
```

---

## Task 7: Import a GEDCOM as a project

**Files:**
- Modify: `apps/web/src/state/store.ts` — strip localStorage from `loadModel` (:469-515), add `importGedcom`, wire the scheduler
- Test: `apps/web/src/state/import.test.ts` (create)

**Interfaces:**
- Consumes: `sanitizeProjectName`/`uniqueProjectName` (Task 1), `SessionStore`/`IdbSessionStore`/`requestPersistentStorage` (Task 3), `Workspace.listProjectSummaries` (Task 4), `SaveScheduler` (Task 6)
- Produces:
  - `AppState.session: SessionStore | null`
  - `AppState.saveState: { status: SaveStatus; lastSavedAt: string | null }`
  - `AppState.importGedcom(bytes: Uint8Array, fileName: string): Promise<void>`
  - `AppState.setSessionStore(store: SessionStore | null): void` — test seam
  - `AppState.flushSaves(): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/state/import.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store.js';
import { MemSessionStore } from '../fs/memSessionStore.js';
import pedigreeGed from '../../../../packages/core/tests/fixtures/pedigree-collapse.ged?raw';
import cousinsGed from '../../../../packages/core/tests/fixtures/cousins.ged?raw';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('importGedcom — auto-creates a project', () => {
  let session: MemSessionStore;

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    session = new MemSessionStore();
    useStore.getState().setSessionStore(session);
  });

  it('names the project from the filename and stores source + record', async () => {
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'jarrell-tree.ged');
    await useStore.getState().flushSaves();

    const s = useStore.getState();
    expect(s.projectName).toBe('jarrell-tree');
    expect(s.model).not.toBeNull();

    const record = await session.getProject('jarrell-tree');
    expect(record).not.toBeNull();
    expect(await session.hasSource(record!.sourceHash)).toBe(true);
    expect(await session.getLastProject()).toBe('jarrell-tree');
  });

  it('sanitizes an illegal filename into a safe project name', async () => {
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'M*A*S*H.ged');
    expect(useStore.getState().projectName).toBe('M A S H');
  });

  it('reopens the existing project when the same bytes are imported again', async () => {
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    await useStore.getState().flushSaves();
    useStore.getState().setFocal('I11');
    await useStore.getState().flushSaves();

    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    await useStore.getState().flushSaves();

    const s = useStore.getState();
    expect(s.projectName).toBe('tree'); // not "tree (2)"
    expect(s.focalPersonId).toBe('I11'); // prior work intact
    expect(await session.listProjects()).toHaveLength(1);
  });

  it('creates a second project when different bytes share a filename', async () => {
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    await useStore.getState().flushSaves();
    await useStore.getState().importGedcom(bytes(cousinsGed), 'tree.ged');
    await useStore.getState().flushSaves();

    expect(useStore.getState().projectName).toBe('tree (2)');
    const names = (await session.listProjects()).map((r) => r.name).sort();
    expect(names).toEqual(['tree', 'tree (2)']);
  });

  it('autosaves an edit made after import without any explicit save', async () => {
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    useStore.getState().setFocal('I11');
    useStore.getState().editPerson('I11', { nameRaws: ['Edited /Name/'], sex: 'M' });
    await useStore.getState().flushSaves();

    const record = await session.getProject('tree');
    expect(record!.ops).toHaveLength(1);
    expect(record!.focalPersonId).toBe('I11');
  });

  it('works with no session store at all (storage disabled)', async () => {
    useStore.getState().setSessionStore(null);
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    expect(useStore.getState().model).not.toBeNull();
    expect(useStore.getState().projectName).toBe('tree');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @genealogy/web test -- import`
Expected: FAIL — `setSessionStore is not a function`.

- [ ] **Step 3: Strip localStorage persistence from the store**

In `apps/web/src/state/store.ts`, delete lines 65-166 entirely — the whole `localStorage fallback` block (`rememberKey`, `opsKey`, `auxKey`, `lsGet`, `lsSet`, `rememberFocal`, `recallFocal`, `loadOpsLS`, `saveOpsLS`, `AuxState`, `loadAuxLS`, `saveAuxLS`) and the `Project-mode autosave` block (`saveTimer`, `currentProjectFile`, `persist`).

Replace with a module-level scheduler and a snapshot builder:

```ts
// ---- Autosave ------------------------------------------------------------
// One scheduler for the app's lifetime. It pulls a snapshot from the store on
// each run rather than capturing state at schedule time, so a burst of edits
// coalesces into a single write of the latest state.

let scheduler: SaveScheduler | null = null;
let storeRef: (() => AppState) | null = null;

function snapshotOf(s: AppState): SaveSnapshot | null {
  if (!s.projectName || !s.baseModel) return null;
  return {
    record: {
      name: s.projectName,
      sourceHash: s.sourceHash ?? '',
      sourceFileName: s.fileName ?? 'source.ged',
      focalPersonId: s.focalPersonId,
      ops: s.ops,
      checklists: s.checklists,
      settings: s.settings,
      createdAt: s.projectCreatedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    sourceBytes: s.sourceBytes,
  };
}

/** Queue a save of the current state to every available backend. */
function persist(get: () => AppState): void {
  storeRef = get;
  scheduler?.schedule();
}
```

Every existing `persist(get)` call site keeps working unchanged (`applyOpLog`, `setFocal`, `setOrientation`, `createChecklist`, `deleteChecklist`, `addChecklistProof`, `removeChecklistProof`).

Add these imports at the top:

```ts
import { sanitizeProjectName, uniqueProjectName } from '../fs/projectName.js';
import { sha256Hex } from '../fs/hash.js';
import {
  IdbSessionStore,
  requestPersistentStorage,
  type SessionStore,
} from '../fs/sessionStore.js';
import {
  SaveScheduler,
  type FolderStatus,
  type SaveSnapshot,
  type SaveStatus,
} from './persistence.js';
```

- [ ] **Step 4: Add the new state fields**

In the `AppState` interface, extend the persistence block (after line 252):

```ts
  // ---- persistence / workspace ----
  workspace: Workspace | null;
  workspaceName: string | null;
  folderStatus: FolderStatus;
  projects: string[];
  projectName: string | null;
  /** Content hash of the open project's GEDCOM. */
  sourceHash: string | null;
  projectCreatedAt: string | null;
  session: SessionStore | null;
  saveState: { status: SaveStatus; lastSavedAt: string | null };
  vaultDocs: VaultDoc[];
  checklists: SarChecklistState[];
  settings: ProjectSettings;

  // ---- session lifecycle ----
  setSessionStore: (store: SessionStore | null) => void;
  importGedcom: (bytes: Uint8Array, fileName: string) => Promise<void>;
  flushSaves: () => Promise<void>;
  reconnectWorkspace: () => Promise<void>;
  backfillFolder: () => Promise<void>;
```

And the matching initial values (after line 467):

```ts
    folderStatus: 'none',
    sourceHash: null,
    projectCreatedAt: null,
    session: typeof indexedDB !== 'undefined' ? new IdbSessionStore() : null,
    saveState: { status: 'idle', lastSavedAt: null },
```

- [ ] **Step 5: Strip localStorage from `loadModel` and add the new actions**

Replace `loadModel`'s body (lines 469-515). The two localStorage reads go; a caller now supplies ops and aux explicitly:

```ts
    loadModel: (baseModel, fileName, sourceBytes) => {
      const model = applyOps(baseModel, []);
      const graph = buildGraph(model);
      set({
        ...emptyInternal,
        baseModel,
        ops: [],
        redoStack: [],
        model,
        graph,
        fileName,
        sourceBytes: sourceBytes ?? null,
        warnings: model.warnings,
        focalPersonId: null,
        view: null,
        collapsePoints: [],
        detailPersonId: null,
        selectedIds: [],
        highlight: null,
        focalPickerOpen: false,
        mergeOpen: false,
        notice: null,
        mapAncestorId: null,
        checklists: [],
        settings: { ...DEFAULT_SETTINGS },
        projectName: null,
      });

      if (model.persons.size === 0) {
        set({ notice: 'No individuals found in this file.' });
        return;
      }
      const declared = model.header?.rootPersonId;
      if (declared && model.persons.has(declared)) get().setFocal(declared);
      else set({ focalPickerOpen: true });
    },
```

Then add the new actions. Place them just before `connectWorkspace`:

```ts
    setSessionStore: (store) => set({ session: store }),

    flushSaves: async () => {
      await scheduler?.flush();
    },

    importGedcom: async (bytes, fileName) => {
      const hash = await sha256Hex(bytes);
      const { session, workspace } = get();

      // 1. Same bytes already imported? Reopen, keeping every edit.
      const records = session ? await session.listProjects() : [];
      const sessionHit = records.find((r) => r.sourceHash === hash);
      if (sessionHit) {
        await get().openProjectByName(sessionHit.name);
        set({ notice: `Reopened "${sessionHit.name}".` });
        return;
      }
      if (workspace) {
        const summaries = await workspace.listProjectSummaries();
        const folderHit = summaries.find((p) => p.sourceHash === hash);
        if (folderHit) {
          await get().openProjectByName(folderHit.name);
          set({ notice: `Reopened "${folderHit.name}".` });
          return;
        }
      }

      // 2. New content: create a project named from the file.
      const taken = [...records.map((r) => r.name), ...get().projects];
      const name = uniqueProjectName(sanitizeProjectName(fileName), taken);
      const now = new Date().toISOString();

      get().loadModel(parseGedcom(bytes), fileName, bytes);
      set({
        projectName: name,
        sourceHash: hash,
        projectCreatedAt: now,
        notice: `Created project "${name}".`,
      });

      if (session) void requestPersistentStorage();
      persist(get);
      await get().refreshProjects();
    },
```

- [ ] **Step 6: Construct the scheduler**

At the very end of the `create<AppState>` factory, after the returned object literal is defined, the scheduler needs a reference to the store. Add this immediately after `export const useStore = create<AppState>(...)`:

```ts
// The scheduler pulls live state through `useStore.getState()`, so it is wired
// after the store exists. Snapshot-on-run (not on-schedule) is what lets a burst
// of edits collapse into one write of the final state.
scheduler = new SaveScheduler({
  snapshot: () => snapshotOf(useStore.getState()),
  session: () => useStore.getState().session,
  workspace: () => useStore.getState().workspace,
  onSaveState: (status, at) =>
    useStore.setState((s) => ({
      saveState: { status, lastSavedAt: at ?? s.saveState.lastSavedAt },
    })),
  onFolderState: (status) => useStore.setState({ folderStatus: status }),
});
```

Delete the now-unused `storeRef` variable if it is not referenced (it exists only to document the wiring; remove it and the `storeRef = get;` line in `persist`).

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @genealogy/web test -- import`
Expected: PASS, 6 tests.

Then the whole suite, which will now show the expected localStorage failures:

Run: `pnpm --filter @genealogy/web test`
Expected: FAIL in `store.test.ts` ("honours a remembered choice", "setFocal … remembers the choice") and `merge.test.ts` (two `genealogy:ops:` assertions). Task 10 fixes these. All other suites pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/state/store.ts apps/web/src/state/import.test.ts
git commit -m "feat(state): auto-create a persistent project on GEDCOM import"
```

---

## Task 8: Restore on boot, and folder backfill

**Files:**
- Modify: `apps/web/src/state/store.ts` — add `restoreSession`, `backfillFolder`; update `openProjectByName`, `deleteProjectByName`, `renameCurrentProject`
- Test: `apps/web/src/state/restore.test.ts` (create)

**Interfaces:**
- Consumes: everything from Tasks 1-7
- Produces:
  - `AppState.restoreSession(): Promise<void>`
  - `AppState.backfillFolder(): Promise<void>` (replaces the Task 5 stub)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/state/restore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store.js';
import { MemSessionStore } from '../fs/memSessionStore.js';
import { Workspace } from '../fs/workspace.js';
import { MemDir } from '../fs/memfs.js';
import pedigreeGed from '../../../../packages/core/tests/fixtures/pedigree-collapse.ged?raw';

const bytes = (s: string) => new TextEncoder().encode(s);

/** Import a project, then simulate a cold start with the same session store. */
async function importThenReload(session: MemSessionStore, fileName = 'tree.ged') {
  useStore.getState().setSessionStore(session);
  await useStore.getState().importGedcom(bytes(pedigreeGed), fileName);
  useStore.getState().setFocal('I11');
  useStore.getState().editPerson('I11', { nameRaws: ['Edited /Name/'], sex: 'M' });
  await useStore.getState().flushSaves();

  useStore.setState(useStore.getInitialState(), true); // fresh page load
  useStore.getState().setSessionStore(session);
  await useStore.getState().restoreSession();
}

describe('restoreSession', () => {
  let session: MemSessionStore;

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    session = new MemSessionStore();
  });

  it('reopens the last project with its model, ops, and focal person', async () => {
    await importThenReload(session);
    const s = useStore.getState();
    expect(s.projectName).toBe('tree');
    expect(s.model).not.toBeNull();
    expect(s.ops).toHaveLength(1);
    expect(s.focalPersonId).toBe('I11');
    expect(s.view).not.toBeNull();
    expect(s.focalPickerOpen).toBe(false);
  });

  it('leaves the app empty when there is no last project', async () => {
    useStore.getState().setSessionStore(session);
    await useStore.getState().restoreSession();
    expect(useStore.getState().model).toBeNull();
    expect(useStore.getState().projectName).toBeNull();
  });

  it('degrades to the empty state when the source bytes are missing', async () => {
    await importThenReload(session);
    const hash = (await session.getProject('tree'))!.sourceHash;
    await session.deleteSource(hash);

    useStore.setState(useStore.getInitialState(), true);
    useStore.getState().setSessionStore(session);
    await useStore.getState().restoreSession();

    expect(useStore.getState().model).toBeNull();
    expect(useStore.getState().notice).toContain('could not be restored');
  });

  it('does nothing harmful with no session store', async () => {
    useStore.getState().setSessionStore(null);
    await useStore.getState().restoreSession();
    expect(useStore.getState().model).toBeNull();
  });
});

describe('backfillFolder', () => {
  let session: MemSessionStore;

  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    session = new MemSessionStore();
  });

  it('mirrors browser-only projects to a newly connected folder', async () => {
    useStore.getState().setSessionStore(session);
    await useStore.getState().importGedcom(bytes(pedigreeGed), 'tree.ged');
    await useStore.getState().flushSaves();

    const workspace = new Workspace(new MemDir());
    useStore.setState({ workspace, folderStatus: 'connected' });
    await useStore.getState().backfillFolder();

    expect(await workspace.listProjects()).toEqual(['tree']);
    const opened = await workspace.openProject('tree');
    expect(opened!.project.focalPersonId).toBe(useStore.getState().focalPersonId);
  });

  it('does not overwrite a project already present in the folder', async () => {
    const workspace = new Workspace(new MemDir());
    await workspace.createProject('tree', bytes(pedigreeGed), 'tree.ged', 'existing-hash');
    useStore.getState().setSessionStore(session);
    useStore.setState({ workspace, folderStatus: 'connected' });
    await useStore.getState().backfillFolder();

    expect((await workspace.openProject('tree'))!.project.sourceHash).toBe('existing-hash');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @genealogy/web test -- restore`
Expected: FAIL — `restoreSession is not a function`.

- [ ] **Step 3: Implement `restoreSession` and `backfillFolder`**

Add to `store.ts`, next to `importGedcom`:

```ts
    /**
     * Cold start. Two independent halves: the project restores from the session
     * store with no permission and no user gesture, and the folder rebinds
     * opportunistically. A restored project renders whether or not the folder
     * comes back.
     */
    restoreSession: async () => {
      const { session } = get();
      if (session) {
        const lastName = await session.getLastProject();
        const record = lastName ? await session.getProject(lastName) : null;
        const source = record ? await session.getSource(record.sourceHash) : null;

        if (record && source) {
          const baseModel = parseGedcom(source);
          const model = applyOps(baseModel, record.ops);
          const graph = buildGraph(model);
          set({
            ...emptyInternal,
            baseModel,
            ops: record.ops,
            redoStack: [],
            model,
            graph,
            fileName: record.sourceFileName,
            sourceBytes: source,
            sourceHash: record.sourceHash,
            projectName: record.name,
            projectCreatedAt: record.createdAt,
            checklists: record.checklists,
            settings: record.settings,
            warnings: model.warnings,
            focalPersonId: null,
            view: null,
            collapsePoints: [],
            detailPersonId: null,
            selectedIds: [],
            highlight: null,
            focalPickerOpen: false,
            mergeOpen: false,
            notice: null,
            mapAncestorId: null,
            saveState: { status: 'saved', lastSavedAt: record.updatedAt },
          });
          const focal = record.focalPersonId;
          if (focal && model.persons.has(focal)) get().setFocal(focal);
          else if (model.persons.size > 0) set({ focalPickerOpen: true });
        } else if (record) {
          // Pointer survived but the bytes did not — clear it so the next boot
          // starts clean instead of hitting this every time.
          await session.setLastProject(null);
          set({ notice: `Project "${record.name}" could not be restored — its source is missing.` });
        }
      }

      await get().restoreWorkspace();
      if (get().workspace) await get().backfillFolder();
    },

    /** Mirror any project that exists only in the browser to the bound folder. */
    backfillFolder: async () => {
      const { workspace, session } = get();
      if (!workspace || !session) return;
      try {
        const onDisk = new Set(await workspace.listProjects());
        for (const record of await session.listProjects()) {
          if (onDisk.has(record.name)) continue;
          const source = await session.getSource(record.sourceHash);
          if (!source) continue;
          await workspace.createProject(
            record.name,
            source,
            record.sourceFileName,
            record.sourceHash,
          );
          await workspace.saveProject(toProjectFile(record));
        }
        set({ folderStatus: 'connected' });
        await get().refreshProjects();
      } catch {
        set({ folderStatus: 'error' });
      }
    },
```

Add `toProjectFile` to the `persistence.js` import in `store.ts`.

- [ ] **Step 4: Update the project lifecycle actions**

`openProjectByName` (line 842) must also set the new fields and cache folder-only projects into the session store. Replace its body's `set({...})` block additions and add caching at the end:

```ts
    openProjectByName: async (name) => {
      await get().flushSaves(); // don't lose pending edits on the outgoing project
      const { workspace, session } = get();

      // Prefer the browser copy: it is authoritative and needs no permission.
      const record = session ? await session.getProject(name) : null;
      const cached = record ? await session.getSource(record.sourceHash) : null;

      let gedcomBytes: Uint8Array;
      let ops: EditOp[];
      let checklists: SarChecklistState[];
      let settings: ProjectSettings;
      let sourceHash: string;
      let sourceFileName: string;
      let createdAt: string;
      let focalPersonId: string | null;

      if (record && cached) {
        gedcomBytes = cached;
        ({ ops, checklists, settings, sourceHash, sourceFileName, focalPersonId } = record);
        createdAt = record.createdAt;
      } else {
        if (!workspace) {
          set({ notice: `Could not open project "${name}".` });
          return;
        }
        const opened = await workspace.openProject(name);
        if (!opened) {
          set({ notice: `Could not open project "${name}".` });
          return;
        }
        gedcomBytes = opened.gedcomBytes;
        ops = opened.project.ops;
        checklists = opened.project.checklists;
        settings = opened.project.settings;
        sourceFileName = opened.project.sourceFileName;
        focalPersonId = opened.project.focalPersonId;
        createdAt = opened.project.updatedAt;
        // A folder project written before sourceHash existed: compute it now so
        // the next import can match by content.
        sourceHash = opened.project.sourceHash || (await sha256Hex(gedcomBytes));
      }

      const baseModel = parseGedcom(gedcomBytes);
      const model = applyOps(baseModel, ops);
      const graph = buildGraph(model);
      set({
        ...emptyInternal,
        baseModel,
        ops,
        redoStack: [],
        model,
        graph,
        fileName: sourceFileName,
        sourceBytes: gedcomBytes,
        sourceHash,
        projectName: name,
        projectCreatedAt: createdAt,
        checklists,
        settings,
        warnings: model.warnings,
        focalPersonId: null,
        view: null,
        collapsePoints: [],
        detailPersonId: null,
        selectedIds: [],
        highlight: null,
        focalPickerOpen: false,
        mergeOpen: false,
        notice: `Opened project "${name}".`,
        mapAncestorId: null,
      });
      if (focalPersonId && model.persons.has(focalPersonId)) get().setFocal(focalPersonId);
      else if (model.persons.size > 0) set({ focalPickerOpen: true });

      // Cache a folder-only project so the next cold start restores it without
      // the folder being present.
      persist(get);
      await get().refreshVault();
    },
```

`deleteProjectByName` (line 892) must clear the session record and the pointer:

```ts
    deleteProjectByName: async (name) => {
      const { workspace, session, projectName } = get();
      if (workspace) await workspace.deleteProject(name);
      if (session) await session.deleteProject(name);
      if (projectName === name) {
        set({ projectName: null, sourceHash: null, projectCreatedAt: null });
        if (session) await session.setLastProject(null);
      }
      await get().refreshProjects();
    },
```

`renameCurrentProject` (line 884) must rename in both places:

```ts
    renameCurrentProject: async (name) => {
      const { workspace, session, projectName } = get();
      if (!projectName) return;
      if (workspace) await workspace.renameProject(projectName, name);
      if (session) await session.renameProject(projectName, name);
      set({ projectName: name, notice: `Renamed to "${name}".` });
      persist(get);
      await get().refreshProjects();
    },
```

`refreshProjects` (line 797) should union folder and session projects, since some exist only in the browser:

```ts
    refreshProjects: async () => {
      const { workspace, session } = get();
      const names = new Set<string>();
      try {
        if (workspace) for (const n of await workspace.listProjects()) names.add(n);
        if (session) for (const r of await session.listProjects()) names.add(r.name);
      } catch {
        /* ignore — a partial list is better than none */
      }
      set({ projects: [...names].sort((a, b) => a.localeCompare(b)) });
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @genealogy/web test -- restore`
Expected: PASS, 6 tests.

Run: `pnpm --filter @genealogy/web test -- import`
Expected: still PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/state/store.ts apps/web/src/state/restore.test.ts
git commit -m "feat(state): restore the last project on boot and backfill the folder"
```

---

## Task 9: Wire the UI

**Files:**
- Modify: `apps/web/src/App.tsx` (:79-151)
- Modify: `apps/web/src/upload/UploadButton.tsx` (whole file)
- Modify: `apps/web/src/panels/WorkspaceModal.tsx` (:14-18, :73-102)
- Test: `apps/web/src/App.test.tsx` (append)

**Interfaces:**
- Consumes: `importGedcom`, `restoreSession`, `flushSaves`, `reconnectWorkspace`, `saveState`, `folderStatus` (Tasks 5, 7, 8)
- Produces: no new exports

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/App.test.tsx`:

```ts
describe('App — save status and folder banner', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
  });

  it('shows a saved indicator once a project has been saved', () => {
    useStore.setState({
      projectName: 'tree',
      saveState: { status: 'saved', lastSavedAt: new Date().toISOString() },
    });
    render(<App />);
    expect(screen.getByText(/Saved/)).toBeInTheDocument();
  });

  it('shows the folder-unavailable banner when a folder write fails', () => {
    useStore.setState({ projectName: 'tree', folderStatus: 'error' });
    render(<App />);
    expect(screen.getByText(/Can't write to the workspace folder/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reconnect/ })).toBeInTheDocument();
  });

  it('shows no banner when the folder is healthy', () => {
    useStore.setState({ projectName: 'tree', folderStatus: 'connected' });
    render(<App />);
    expect(screen.queryByText(/Can't write to the workspace folder/)).toBeNull();
  });
});
```

Check the existing imports at the top of `App.test.tsx` and add whatever is missing from: `import { describe, it, expect, beforeEach } from 'vitest'`, `import { render, screen } from '@testing-library/react'`, `import { useStore } from './state/store.js'`, `import { App } from './App.js'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @genealogy/web test -- App`
Expected: FAIL — no "Saved" text, no banner.

- [ ] **Step 3: Add the status indicator and banner to `App.tsx`**

Add these helpers above `export function App()`:

```ts
function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function SaveIndicator() {
  const { status, lastSavedAt } = useStore((s) => s.saveState);
  const projectName = useStore((s) => s.projectName);
  if (!projectName) return null;
  if (status === 'saving') return <span className="text-gray-500"> · Saving…</span>;
  if (status === 'error')
    return <span className="text-red-600"> · Not saved — storage unavailable</span>;
  if (status === 'saved' && lastSavedAt)
    return <span className="text-gray-500"> · Saved {relativeTime(lastSavedAt)}</span>;
  return null;
}

function FolderBanner() {
  const folderStatus = useStore((s) => s.folderStatus);
  const reconnectWorkspace = useStore((s) => s.reconnectWorkspace);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  if (folderStatus !== 'error' && folderStatus !== 'needs-permission') return null;

  const isError = folderStatus === 'error';
  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span>
        {isError
          ? "Can't write to the workspace folder. Your work is saved in this browser."
          : 'The workspace folder needs permission again. Your work is saved in this browser.'}
      </span>
      <span className="flex shrink-0 gap-2">
        <button
          className="rounded bg-amber-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-amber-700"
          onClick={() => void reconnectWorkspace()}
        >
          Reconnect
        </button>
        <button
          className="rounded border border-amber-300 px-2 py-0.5 text-xs hover:bg-amber-100"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </span>
    </div>
  );
}
```

In `App()`, swap the boot effect (lines 85, 96-99) for `restoreSession` plus a flush on hide:

```ts
  const restoreSession = useStore((s) => s.restoreSession);
  const flushSaves = useStore((s) => s.flushSaves);

  // Restore the last project and re-bind the folder (both no-ops when absent).
  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  // A 300ms debounce means an edit made just before the tab closes would
  // otherwise be lost. Flush on the last events the browser reliably delivers.
  useEffect(() => {
    const flush = () => void flushSaves();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [flushSaves]);
```

Add `<SaveIndicator />` inside the header's subtitle `<div>`, right after `{fileName}` (line 108). Add `<FolderBanner />` immediately after the closing `</header>` tag (line 151).

- [ ] **Step 4: Route uploads through `importGedcom`**

Replace `apps/web/src/upload/UploadButton.tsx`:

```tsx
import { useRef, useState } from 'react';
import { useStore } from '../state/store.js';
import { readFileAsBytes } from './loadGedcom.js';
// Bundled sample so the app is verifiable without hunting for a .ged file.
import sampleGed from '../../../../packages/core/tests/fixtures/pedigree-collapse.ged?raw';

const SAMPLE_NAME = 'pedigree-collapse-sample.ged';

export function UploadButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const importGedcom = useStore((s) => s.importGedcom);
  const [busy, setBusy] = useState(false);

  async function run(bytes: Uint8Array, fileName: string) {
    setBusy(true);
    try {
      await importGedcom(bytes, fileName);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".ged,.gedcom,text/plain"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void readFileAsBytes(file).then((bytes) => run(bytes, file.name));
          // Allow re-picking the same file (change does not fire otherwise).
          e.target.value = '';
        }}
      />
      <button
        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Loading…' : 'Load GEDCOM'}
      </button>
      <button
        className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100"
        disabled={busy}
        onClick={() => void run(new TextEncoder().encode(sampleGed), SAMPLE_NAME)}
      >
        Load sample
      </button>
    </div>
  );
}
```

The sample's filename changes from `'pedigree-collapse.ged (sample)'` to `'pedigree-collapse-sample.ged'` so `sanitizeProjectName` yields the clean `pedigree-collapse-sample` rather than leaving `.ged` mid-string.

- [ ] **Step 5: Simplify `WorkspaceModal.tsx`**

Remove the `saveAsProject` subscription (line 18), the `newName` state (line 23), and the entire "Save current as project" `<section>` (lines 76-102). Also remove the now-unused `fileName` and `sourceBytes` subscriptions (lines 14-15).

Replace the Disconnect row (lines 50-70) so it also offers Reconnect when the grant has lapsed:

```tsx
            {workspace ? (
              <div className="mt-1 flex items-center justify-between gap-2 rounded border border-gray-200 bg-gray-50 p-2 text-sm">
                <span>
                  Connected: <span className="font-medium">{workspaceName}</span>
                </span>
                <button
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-white"
                  onClick={() => void disconnectWorkspace()}
                >
                  Disconnect
                </button>
              </div>
            ) : folderStatus === 'needs-permission' ? (
              <div className="mt-1 space-y-1">
                <p className="text-xs text-gray-600">
                  A workspace folder is remembered but needs permission again.
                </p>
                <button
                  className="rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700"
                  onClick={() => void reconnectWorkspace()}
                >
                  Reconnect folder
                </button>
              </div>
            ) : (
              <button
                className="mt-1 rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                disabled={!supported}
                onClick={() => void connectWorkspace()}
              >
                Pick workspace folder…
              </button>
            )}
```

Add the two new subscriptions near the others:

```tsx
  const folderStatus = useStore((s) => s.folderStatus);
  const reconnectWorkspace = useStore((s) => s.reconnectWorkspace);
```

Change the projects `<section>` guard so it renders without a workspace — projects now exist in the browser alone. Replace `{workspace && (<>` (line 73) with `<>` and its matching `</>)}` with `</>`, keeping the workspace-connection section above it. Update the empty-state copy from `No projects yet.` to:

```tsx
                  <p className="mt-1 text-xs text-gray-500">
                    No projects yet — load a GEDCOM to create one.
                  </p>
```

Guard the rename section on `projectName` only (it already is, line 147), and mark browser-only projects in the list by adding, after the `(open)` span (line 125):

```tsx
                          {!workspace && (
                            <span className="ml-1 text-[11px] text-gray-400">
                              (this browser)
                            </span>
                          )}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @genealogy/web test -- App`
Expected: PASS.

Run: `pnpm --filter @genealogy/web typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/App.test.tsx \
        apps/web/src/upload/UploadButton.tsx apps/web/src/panels/WorkspaceModal.tsx
git commit -m "feat(web): restore on boot, show save status, and surface folder failures"
```

---

## Task 10: Retire the legacy localStorage keys

**Files:**
- Create: `apps/web/src/state/legacyCleanup.ts`
- Test: `apps/web/src/state/legacyCleanup.test.ts`
- Modify: `apps/web/src/main.tsx` (call the cleanup once at startup)
- Modify: `apps/web/src/state/store.test.ts` (:31-45)
- Modify: `apps/web/src/state/merge.test.ts` (:57, :74)

**Interfaces:**
- Consumes: nothing
- Produces: `clearLegacyPersistenceKeys(): number` — returns how many keys it removed

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/state/legacyCleanup.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { clearLegacyPersistenceKeys } from './legacyCleanup.js';

describe('clearLegacyPersistenceKeys', () => {
  beforeEach(() => localStorage.clear());

  it('removes the superseded per-file persistence keys', () => {
    localStorage.setItem('genealogy:focal:tree.ged', 'I1');
    localStorage.setItem('genealogy:ops:tree.ged', '[]');
    localStorage.setItem('genealogy:aux:tree.ged', '{}');
    expect(clearLegacyPersistenceKeys()).toBe(3);
    expect(localStorage.getItem('genealogy:ops:tree.ged')).toBeNull();
  });

  it('preserves the geocoding place cache', () => {
    localStorage.setItem('genealogy:placeCache', '{"somewhere":[1,2]}');
    clearLegacyPersistenceKeys();
    expect(localStorage.getItem('genealogy:placeCache')).toBe('{"somewhere":[1,2]}');
  });

  it('preserves UI layout preferences', () => {
    localStorage.setItem('ui:leftOpen', '0');
    clearLegacyPersistenceKeys();
    expect(localStorage.getItem('ui:leftOpen')).toBe('0');
  });

  it('is safe to run twice', () => {
    localStorage.setItem('genealogy:ops:a.ged', '[]');
    expect(clearLegacyPersistenceKeys()).toBe(1);
    expect(clearLegacyPersistenceKeys()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @genealogy/web test -- legacyCleanup`
Expected: FAIL — cannot resolve `./legacyCleanup.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/state/legacyCleanup.ts`:

```ts
// One-time removal of the per-file localStorage persistence that the session
// store replaces. Those op-logs are unreachable by design: the GEDCOM bytes they
// were built against were never stored, so there is no base model to replay them
// over. Dropping them is deliberate (spec, Decision 5).
//
// Deliberately narrow: `genealogy:placeCache` belongs to geo/resolver.ts and
// holds resolved geocoding lookups worth keeping, and `ui:*` holds panel layout.

const LEGACY_PREFIXES = ['genealogy:focal:', 'genealogy:ops:', 'genealogy:aux:'];

/** Returns the number of keys removed. */
export function clearLegacyPersistenceKeys(): number {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && LEGACY_PREFIXES.some((p) => key.startsWith(p))) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
    return doomed.length;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 4: Call it at startup**

In `apps/web/src/main.tsx`, add the import and call it before rendering:

```ts
import { clearLegacyPersistenceKeys } from './state/legacyCleanup.js';

clearLegacyPersistenceKeys();
```

- [ ] **Step 5: Fix the two test files that assert on the removed keys**

In `apps/web/src/state/store.test.ts`, replace the two localStorage-based tests (lines 31-45) with equivalents that exercise the real mechanism:

```ts
  it('honours the focal person declared in the GEDCOM header', () => {
    load(pedigreeGed);
    // pedigree-collapse.ged declares no root person, so the picker opens.
    expect(useStore.getState().focalPickerOpen).toBe(true);
  });

  it('setFocal builds the ego network centred on the chosen person', () => {
    load(pedigreeGed);
    useStore.getState().setFocal('I11');
    expect(useStore.getState().focalPersonId).toBe('I11');
    expect(ids()).toContain('I11');
  });
```

Focal persistence across sessions is now covered by `restore.test.ts` ("reopens the last project with its model, ops, and focal person"), which tests the behaviour rather than the storage key.

In `apps/web/src/state/merge.test.ts`, replace the two `genealogy:ops:` assertions. Line 57 becomes an assertion on the store's op-log:

```ts
    expect(useStore.getState().ops).toHaveLength(1);
    expect(useStore.getState().ops[0]).toMatchObject({ kind: 'merge', mergeId: 'I3DUP' });
```

And line 74 (after the undo):

```ts
    expect(useStore.getState().ops).toEqual([]);
```

Op persistence is covered by `import.test.ts` ("autosaves an edit made after import").

- [ ] **Step 6: Run the full suite**

Run: `pnpm --filter @genealogy/web test`
Expected: PASS — every suite, including the previously failing `store.test.ts` and `merge.test.ts`.

Run: `pnpm -r test && pnpm typecheck && pnpm lint`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/state/legacyCleanup.ts apps/web/src/state/legacyCleanup.test.ts \
        apps/web/src/main.tsx apps/web/src/state/store.test.ts apps/web/src/state/merge.test.ts
git commit -m "chore(state): drop the superseded localStorage persistence keys"
```

---

## Task 11: Multi-tab clobber detection

**Optional — droppable.** Everything above works without it. It exists because two tabs open on the same project would otherwise silently overwrite each other via last-write-wins, which is the failure mode hardest to notice and impossible to recover from.

**Files:**
- Modify: `apps/web/src/state/persistence.ts`
- Test: `apps/web/src/state/persistence.test.ts` (append)

**Interfaces:**
- Consumes: `SessionStore`, `SaveScheduler` (Tasks 3, 6)
- Produces: `SaveSchedulerOptions.onConflict?: (name: string) => void`

- [ ] **Step 1: Write the failing test**

Append to the `SaveScheduler` describe block in `apps/web/src/state/persistence.test.ts`:

```ts
  it('stops saving and reports a conflict when another tab wrote the record', async () => {
    const conflicts: string[] = [];
    const scheduler = new SaveScheduler({
      snapshot: () => snapshot,
      session: () => session,
      workspace: () => null,
      onSaveState: () => {},
      onFolderState: () => {},
      onConflict: (name) => conflicts.push(name),
    });

    scheduler.schedule();
    await scheduler.flush();

    // Another tab writes the same record behind our back.
    await session.putProject({
      ...(await session.getProject('tree'))!,
      updatedAt: '2099-01-01T00:00:00.000Z',
      focalPersonId: 'OTHER-TAB',
    });

    scheduler.schedule();
    await scheduler.flush();

    expect(conflicts).toEqual(['tree']);
    // The other tab's write survived; we did not clobber it.
    expect((await session.getProject('tree'))!.focalPersonId).toBe('OTHER-TAB');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @genealogy/web test -- persistence`
Expected: FAIL — `conflicts` is empty and `focalPersonId` was overwritten.

- [ ] **Step 3: Implement the check**

In `apps/web/src/state/persistence.ts`, add to `SaveSchedulerOptions`:

```ts
  /** Called when another tab has written this project since our last save. */
  onConflict?: (name: string) => void;
```

Add two fields to `SaveScheduler`:

```ts
  /** updatedAt we last wrote, per project — our claim on the record. */
  private readonly lastWritten = new Map<string, string>();
  private conflicted = false;
```

Replace the body of `runSession` with a compare-then-write:

```ts
  private async runSession(): Promise<void> {
    const snap = this.opts.snapshot();
    const session = this.opts.session();
    if (!snap || !session || this.conflicted) return;

    this.opts.onSaveState('saving', null);
    try {
      // If the stored record moved on from what we last wrote, another tab owns
      // it. Stop rather than overwrite work we cannot see.
      const claimed = this.lastWritten.get(snap.record.name);
      if (claimed) {
        const current = await session.getProject(snap.record.name);
        if (current && current.updatedAt !== claimed) {
          this.conflicted = true;
          this.opts.onSaveState('error', null);
          this.opts.onConflict?.(snap.record.name);
          return;
        }
      }

      if (snap.sourceBytes && !this.storedSources.has(snap.record.sourceHash)) {
        if (!(await session.hasSource(snap.record.sourceHash))) {
          await session.putSource(snap.record.sourceHash, snap.sourceBytes);
        }
        this.storedSources.add(snap.record.sourceHash);
      }

      const updatedAt = new Date().toISOString();
      const ok = await session.putProject({ ...snap.record, updatedAt });
      await session.setLastProject(snap.record.name);
      if (ok) {
        this.lastWritten.set(snap.record.name, updatedAt);
        this.opts.onSaveState('saved', updatedAt);
      } else {
        this.opts.onSaveState('error', null);
      }
    } catch {
      this.opts.onSaveState('error', null);
    }
  }
```

- [ ] **Step 4: Surface it in the store**

In `store.ts`, add to the `SaveScheduler` construction from Task 7 Step 6:

```ts
  onConflict: (name) =>
    useStore.setState({
      notice: `"${name}" is open in another tab. Editing is no longer being saved here — close this tab or reload to continue.`,
    }),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @genealogy/web test -- persistence`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/state/persistence.ts apps/web/src/state/persistence.test.ts apps/web/src/state/store.ts
git commit -m "feat(state): detect and refuse cross-tab clobbering of a project"
```

---

## Task 12: End-to-end verification

**Files:** none modified — this is a manual gate before merge.

Automated tests cannot exercise IndexedDB or the File System Access API under jsdom, so the two integration points that matter most have to be confirmed in a real browser once.

- [ ] **Step 1: Full automated suite**

```bash
pnpm -r test
pnpm typecheck
pnpm lint
pnpm format:check
```
Expected: all clean.

- [ ] **Step 2: Cold-start continuity (the primary requirement)**

```
pnpm dev
```
1. Load a real GEDCOM. Confirm the header shows a project name and `Saved just now`.
2. Set a focal person, edit a person, merge two people.
3. **Close the tab entirely.** Reopen the app.
4. Confirm: the tree renders immediately with no upload prompt and no dialog; focal person, the edit, and the merge are all present; the Review tab lists both edits.

- [ ] **Step 3: Folder mirroring and recovery**

1. Connect a workspace folder (`F:\genealogy\Workspace`).
2. Confirm `Workspace\projects\<name>\` now contains `source.ged` and `project.json`, and that `project.json` holds your ops.
3. Make another edit; confirm `project.json` updates within about a second.
4. Rename the workspace folder in Explorer to simulate a lost drive; make an edit.
5. Confirm the amber banner appears and the header still reports the browser save succeeding.
6. Rename it back, click Reconnect, confirm the banner clears and writes resume.

- [ ] **Step 4: Import matching**

1. Import the same GEDCOM again. Confirm it reopens the existing project (notice says "Reopened"), with edits intact and no duplicate in the list.
2. Import a *different* GEDCOM saved under the same filename. Confirm a second project appears as `name (2)` and the original is untouched.

- [ ] **Step 5: Schema and cleanup**

DevTools → Application:
1. IndexedDB → `genealogy-graph` is at version 2 with `handles`, `sources`, `projects`, `meta`.
2. `sources` holds one entry per distinct GEDCOM, not one per save.
3. Local Storage has no `genealogy:focal:*`, `genealogy:ops:*`, or `genealogy:aux:*` keys — and **still has** `genealogy:placeCache` and `ui:*`.

- [ ] **Step 6: Merge**

```bash
git checkout main
git merge --no-ff feat/project-persistence
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: storage model → Tasks 2-3; `fs/idb.ts` single owner → Task 2; boot sequence → Tasks 5, 8, 9; query-only permission → Task 5; import flow with hash matching → Task 7; folder-only projects cached to IndexedDB → Task 8 (`openProjectByName`); `sourceHash` on `ProjectFile` → Task 4; project name sanitization → Task 1; autosave with dual debounce, flush-on-hide, in-flight lock → Tasks 6, 9; `navigator.storage.persist()` → Tasks 3, 7; save-state and folder-status slices → Tasks 6-9; backfill → Task 8; multi-tab detection → Task 11; `saveAsProject` removal → Task 9; `deleteProjectByName` clearing the pointer → Task 8; localStorage cleanup preserving `placeCache` → Task 10; test coverage list → distributed across Tasks 1, 3, 4, 6, 7, 8, 9, 10.

**Ordering constraint.** Task 5 introduces references to `FolderStatus` and `backfillFolder`, which only exist after Tasks 6 and 8. This is called out explicitly in Task 5 Step 2 with a stated workaround. If executing strictly one task at a time with a typecheck gate between each, run Task 6 before Task 5 — the only ordering flexibility the plan needs.

**Type consistency.** `SessionProjectRecord` fields are identical across Tasks 3, 6, 7, and 8. `putProject` returns `Promise<boolean>` in the interface, both implementations, and the scheduler. `sanitizeProjectName`/`uniqueProjectName` signatures match between Tasks 1 and 7. `createProject`'s fourth parameter is `sourceHash` in Task 4's definition and in every Task 6/8 call. `toProjectFile` is defined once in Task 6 and imported by Task 8.
