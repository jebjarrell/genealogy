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
