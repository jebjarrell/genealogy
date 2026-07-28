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
