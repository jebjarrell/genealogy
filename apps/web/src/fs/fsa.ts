// A tiny abstraction over the File System Access API (TRD §2 / handoff §2).
//
// The app binds to a real local folder via `window.showDirectoryPicker()`. To
// keep all the project/vault LOGIC unit-testable (jsdom has no File System
// Access API), every operation goes through these minimal interfaces. The real
// adapter wraps `FileSystemDirectoryHandle`; an in-memory fake (memfs.ts)
// implements the same surface for tests. File-system access stays in the UI
// layer and never leaks into @genealogy/core (the core↔file seam).

export interface FsFile {
  read(): Promise<Uint8Array>;
  readText(): Promise<string>;
  write(data: string | Uint8Array): Promise<void>;
}

export interface FsEntry {
  name: string;
  kind: 'file' | 'directory';
}

export interface FsDir {
  readonly name: string;
  /** Get (optionally creating) a child directory; null when absent and !create. */
  getDir(name: string, create?: boolean): Promise<FsDir | null>;
  /** Get (optionally creating) a child file; null when absent and !create. */
  getFile(name: string, create?: boolean): Promise<FsFile | null>;
  removeEntry(name: string, recursive?: boolean): Promise<void>;
  listEntries(): Promise<FsEntry[]>;
}

// ---- Real adapter over the File System Access API ----------------------

/** Minimal structural types for the parts of the FSA API we use. */
interface FileSystemFileHandleLike {
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: unknown): Promise<void>;
    close(): Promise<void>;
  }>;
}
interface FileSystemDirectoryHandleLike {
  name: string;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemDirectoryHandleLike>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemFileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<
    [string, FileSystemFileHandleLike | FileSystemDirectoryHandleLike]
  >;
}

class RealFile implements FsFile {
  constructor(private readonly handle: FileSystemFileHandleLike) {}
  async read(): Promise<Uint8Array> {
    const file = await this.handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }
  async readText(): Promise<string> {
    const file = await this.handle.getFile();
    return file.text();
  }
  async write(data: string | Uint8Array): Promise<void> {
    const writable = await this.handle.createWritable();
    await writable.write(data);
    await writable.close();
  }
}

class RealDir implements FsDir {
  constructor(private readonly handle: FileSystemDirectoryHandleLike) {}
  get name(): string {
    return this.handle.name;
  }
  async getDir(name: string, create = false): Promise<FsDir | null> {
    try {
      const h = await this.handle.getDirectoryHandle(name, { create });
      return new RealDir(h);
    } catch {
      return null;
    }
  }
  async getFile(name: string, create = false): Promise<FsFile | null> {
    try {
      const h = await this.handle.getFileHandle(name, { create });
      return new RealFile(h);
    } catch {
      return null;
    }
  }
  async removeEntry(name: string, recursive = false): Promise<void> {
    try {
      await this.handle.removeEntry(name, { recursive });
    } catch {
      /* already gone — ignore */
    }
  }
  async listEntries(): Promise<FsEntry[]> {
    const out: FsEntry[] = [];
    for await (const [entryName, h] of this.handle.entries()) {
      out.push({ name: entryName, kind: 'getFile' in h ? 'file' : 'directory' });
    }
    return out;
  }
}

/** Wrap a real `FileSystemDirectoryHandle` as an {@link FsDir}. */
export function dirFromHandle(handle: unknown): FsDir {
  return new RealDir(handle as FileSystemDirectoryHandleLike);
}

/** True when this browser exposes the File System Access directory picker. */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

interface PermissionedHandle {
  queryPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

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
    if (h.requestPermission && (await h.requestPermission(opts)) === 'granted')
      return true;
  } catch {
    return false;
  }
  return false;
}

interface DirectoryPickerWindow {
  showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<unknown>;
}

/** Prompt the user to pick (or create) a workspace root directory. */
export async function pickDirectory(): Promise<unknown | null> {
  if (!isFileSystemAccessSupported()) return null;
  try {
    return await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
      mode: 'readwrite',
    });
  } catch {
    return null; // user cancelled
  }
}
