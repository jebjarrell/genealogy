import type { FsDir, FsEntry, FsFile } from './fsa.js';

// In-memory implementation of the FsDir/FsFile abstraction, used by tests (and
// usable as a non-persistent fallback). Mirrors the real File System Access
// adapter's behavior exactly so the project/vault logic can be exercised under
// jsdom, which has no File System Access API.

class MemFile implements FsFile {
  constructor(private store: { data: Uint8Array }) {}
  async read(): Promise<Uint8Array> {
    return this.store.data;
  }
  async readText(): Promise<string> {
    return new TextDecoder().decode(this.store.data);
  }
  async write(data: string | Uint8Array): Promise<void> {
    this.store.data =
      typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  }
}

interface MemNode {
  files: Map<string, { data: Uint8Array }>;
  dirs: Map<string, MemDir>;
}

export class MemDir implements FsDir {
  readonly name: string;
  private node: MemNode = { files: new Map(), dirs: new Map() };

  constructor(name = 'root') {
    this.name = name;
  }

  async getDir(name: string, create = false): Promise<FsDir | null> {
    const existing = this.node.dirs.get(name);
    if (existing) return existing;
    if (!create) return null;
    const dir = new MemDir(name);
    this.node.dirs.set(name, dir);
    return dir;
  }

  async getFile(name: string, create = false): Promise<FsFile | null> {
    const existing = this.node.files.get(name);
    if (existing) return new MemFile(existing);
    if (!create) return null;
    const store = { data: new Uint8Array() };
    this.node.files.set(name, store);
    return new MemFile(store);
  }

  async removeEntry(name: string, _recursive = false): Promise<void> {
    this.node.files.delete(name);
    this.node.dirs.delete(name);
  }

  async listEntries(): Promise<FsEntry[]> {
    const out: FsEntry[] = [];
    for (const name of this.node.dirs.keys()) out.push({ name, kind: 'directory' });
    for (const name of this.node.files.keys()) out.push({ name, kind: 'file' });
    return out;
  }
}
