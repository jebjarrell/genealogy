import type { FsDir } from './fsa.js';
import { sha256Hex } from './hash.js';
import {
  newProject,
  parseProject,
  serializeProject,
  type ProjectFile,
} from './project.js';
import {
  classifyUpload,
  findByHash,
  parseVaultIndex,
  serializeVaultIndex,
  type VaultDoc,
  type VaultIndex,
} from './vault.js';

// The workspace root: a real local folder bound via the File System Access API.
// Disk layout (handoff §2):
//
//   <root>/
//     projects/<name>/{ source.ged, project.json }
//     vault/{ documents/<hash>.<ext>, vault-index.json }
//
// Projects are folders; the vault is global so a document deduped by content
// hash can back checklists across projects. Writes go temp-then-promote so a
// crash mid-write cannot corrupt project.json.

const PROJECTS = 'projects';
const VAULT = 'vault';
const DOCUMENTS = 'documents';
const VAULT_INDEX = 'vault-index.json';
const PROJECT_JSON = 'project.json';
const PROJECT_TMP = 'project.json.tmp';
const SOURCE_GED = 'source.ged';

export interface AddDocumentResult {
  doc: VaultDoc;
  /** True when an identical file was already in the vault (linked, not copied). */
  deduped: boolean;
}

/**
 * The result of asking whether a folder project holds the tree a caller has
 * open. Only 'match' means "safe to write over"; everything else is either
 * "nothing there" or "we cannot prove it is ours."
 *
 *   absent   - no project folder of that name at all.
 *   match    - same tree: the declared hash matches, or (when the folder
 *              declares no hash) the bytes on disk hash to the same value.
 *   differs  - a different tree lives there. Writing would strand our op-log
 *              beside someone else's GEDCOM.
 *   unknown  - the folder exists but nothing in it identifies the tree: no
 *              readable project.json AND no readable source. Indistinguishable
 *              from 'differs' for safety purposes, and kept separate only so a
 *              caller can word its refusal accurately.
 */
export type SourceComparison = 'absent' | 'match' | 'differs' | 'unknown';

export class Workspace {
  constructor(public readonly root: FsDir) {}

  // ---- Projects --------------------------------------------------------

  private async projectsDir(create: boolean): Promise<FsDir | null> {
    return this.root.getDir(PROJECTS, create);
  }

  async listProjects(): Promise<string[]> {
    const dir = await this.projectsDir(false);
    if (!dir) return [];
    const entries = await dir.listEntries();
    return entries
      .filter((e) => e.kind === 'directory')
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  }

  async hasProject(name: string): Promise<boolean> {
    return (await this.listProjects()).includes(name);
  }

  /**
   * Read one project folder's project.json, falling back to the temp file
   * whenever the main file is absent *or unreadable*. Both halves matter:
   * writeProjectFile truncates project.json on open, so a drive that drops out
   * mid-write leaves a 0-byte project.json sitting beside a complete
   * project.json.tmp. Treating that as "no project here" would let a caller
   * conclude the folder is unclaimed and write over a real project.
   *
   * Single source of truth for both openProject() and readSummary() so the two
   * can never drift apart on which files they are willing to recover from.
   */
  private async readProjectFile(dir: FsDir): Promise<ProjectFile | null> {
    const main = await dir.getFile(PROJECT_JSON, false);
    let project = main ? parseProject(await main.readText()) : null;
    if (!project) {
      const tmp = await dir.getFile(PROJECT_TMP, false);
      if (tmp) project = parseProject(await tmp.readText());
    }
    return project;
  }

  /**
   * Name + content hash for one project, read from its project.json alone so
   * the (potentially huge) source.ged is never touched. Null when the folder or
   * its project.json is absent or unreadable (after the temp-file fallback).
   */
  private async readSummary(
    parent: FsDir,
    name: string,
  ): Promise<{ name: string; sourceHash: string } | null> {
    const dir = await parent.getDir(name, false);
    const project = dir ? await this.readProjectFile(dir) : null;
    return project ? { name, sourceHash: project.sourceHash } : null;
  }

  /**
   * Does the folder project `name` hold the same tree as `sourceHash`? This is
   * the guard that keeps an autosave (or a rename) from writing our metadata
   * over a different family tree that happens to share a name.
   *
   * A declared sourceHash of '' means UNKNOWN - it is the placeholder for
   * project.json files written before the field existed - so it must never be
   * read as "matches whatever you have." It is settled from the bytes on disk
   * instead of guessed: hashing the source once is the only way to tell a
   * legacy copy of our own project from a stranger's, and the answer is
   * durable, because the write that follows a 'match' stamps the real hash into
   * project.json and no later run has to hash anything again.
   */
  async compareSource(name: string, sourceHash: string): Promise<SourceComparison> {
    const parent = await this.projectsDir(false);
    const dir = parent ? await parent.getDir(name, false) : null;
    if (!dir) return 'absent';

    const project = await this.readProjectFile(dir);
    if (project?.sourceHash) {
      return project.sourceHash === sourceHash ? 'match' : 'differs';
    }
    const file = await dir.getFile(project?.sourceFile ?? SOURCE_GED, false);
    if (!file) return 'unknown';
    const onDisk = await sha256Hex(await file.read());
    // An empty `sourceHash` from the caller can never match a real hash, which
    // is the intended outcome: a caller that does not know its own content
    // hash has not proven anything about this folder either.
    return onDisk === sourceHash ? 'match' : 'differs';
  }

  /**
   * Summary for a single named project. Lets a caller that already knows the
   * name check what is on disk without paying for a full listing - the autosave
   * mirror does this on every run.
   */
  async projectSummary(
    name: string,
  ): Promise<{ name: string; sourceHash: string } | null> {
    const parent = await this.projectsDir(false);
    return parent ? this.readSummary(parent, name) : null;
  }

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
      const summary = await this.readSummary(parent, name);
      if (summary) out.push(summary);
    }
    return out;
  }

  /** Atomically write project.json into the given project folder. */
  private async writeProjectFile(dir: FsDir, project: ProjectFile): Promise<void> {
    const text = serializeProject({ ...project, updatedAt: new Date().toISOString() });
    const tmp = await dir.getFile(PROJECT_TMP, true);
    if (tmp) await tmp.write(text);
    const final = await dir.getFile(PROJECT_JSON, true);
    if (final) await final.write(text);
    await dir.removeEntry(PROJECT_TMP);
  }

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

  async openProject(
    name: string,
  ): Promise<{ project: ProjectFile; gedcomBytes: Uint8Array } | null> {
    const parent = await this.projectsDir(false);
    const dir = parent ? await parent.getDir(name, false) : null;
    if (!dir) return null;

    // Prefer project.json; fall back to the temp file if a write was interrupted.
    const project = await this.readProjectFile(dir);
    if (!project) return null;

    const source = await dir.getFile(project.sourceFile, false);
    if (!source) return null;
    const gedcomBytes = await source.read();
    return { project, gedcomBytes };
  }

  async saveProject(project: ProjectFile): Promise<void> {
    const parent = await this.projectsDir(true);
    const dir = parent ? await parent.getDir(project.name, true) : null;
    if (!dir) throw new Error('Cannot open the project folder to save.');
    await this.writeProjectFile(dir, project);
  }

  async renameProject(oldName: string, newName: string): Promise<ProjectFile | null> {
    const parent = await this.projectsDir(true);
    if (!parent) return null;
    const oldDir = await parent.getDir(oldName, false);
    if (!oldDir) return null;
    const opened = await this.openProject(oldName);
    if (!opened) return null;

    const newDir = await parent.getDir(newName, true);
    if (!newDir) return null;
    const source = await newDir.getFile(opened.project.sourceFile, true);
    if (source) await source.write(opened.gedcomBytes);
    const renamed: ProjectFile = { ...opened.project, name: newName };
    await this.writeProjectFile(newDir, renamed);
    await parent.removeEntry(oldName, true);
    return renamed;
  }

  async deleteProject(name: string): Promise<void> {
    const parent = await this.projectsDir(false);
    if (parent) await parent.removeEntry(name, true);
  }

  // ---- Vault (global, content-addressed) -------------------------------

  private async vaultDir(create: boolean): Promise<FsDir | null> {
    return this.root.getDir(VAULT, create);
  }

  private async documentsDir(create: boolean): Promise<FsDir | null> {
    const vault = await this.vaultDir(create);
    return vault ? vault.getDir(DOCUMENTS, create) : null;
  }

  async readVaultIndex(): Promise<VaultIndex> {
    const vault = await this.vaultDir(false);
    const file = vault ? await vault.getFile(VAULT_INDEX, false) : null;
    if (!file) return parseVaultIndex('');
    return parseVaultIndex(await file.readText());
  }

  private async writeVaultIndex(index: VaultIndex): Promise<void> {
    const vault = await this.vaultDir(true);
    const file = vault ? await vault.getFile(VAULT_INDEX, true) : null;
    if (file) await file.write(serializeVaultIndex(index));
  }

  async listDocuments(): Promise<VaultDoc[]> {
    return (await this.readVaultIndex()).documents;
  }

  /**
   * Add a document to the global vault. Dedup by content hash: if the same bytes
   * are already present, the existing entry is returned (deduped=true) and no
   * second copy is written. Returns null when the type is not PDF/JPG/PNG.
   */
  async addDocument(
    bytes: Uint8Array,
    originalName: string,
    mimetype: string,
  ): Promise<AddDocumentResult | null> {
    const kind = classifyUpload(mimetype, originalName);
    if (!kind) return null;

    const hash = await sha256Hex(bytes);
    const index = await this.readVaultIndex();
    const existing = findByHash(index, hash);
    if (existing) return { doc: existing, deduped: true };

    const filename = `${hash}.${kind.ext}`;
    const docsDir = await this.documentsDir(true);
    const file = docsDir ? await docsDir.getFile(filename, true) : null;
    if (file) await file.write(bytes);

    const doc: VaultDoc = {
      docId: hash,
      filename,
      originalName,
      hash,
      mimetype: kind.mime,
      size: bytes.byteLength,
      addedAt: new Date().toISOString(),
      citationLinks: [],
    };
    index.documents.push(doc);
    await this.writeVaultIndex(index);
    return { doc, deduped: false };
  }

  /** Replace a document's citation links and persist the index. */
  async setDocumentLinks(docId: string, citationLinks: string[]): Promise<void> {
    const index = await this.readVaultIndex();
    const doc = index.documents.find((d) => d.docId === docId);
    if (!doc) return;
    doc.citationLinks = [...new Set(citationLinks)];
    await this.writeVaultIndex(index);
  }

  /** Read a stored document's bytes (for preview / open). */
  async readDocument(
    docId: string,
  ): Promise<{ bytes: Uint8Array; doc: VaultDoc } | null> {
    const index = await this.readVaultIndex();
    const doc = index.documents.find((d) => d.docId === docId);
    if (!doc) return null;
    const docsDir = await this.documentsDir(false);
    const file = docsDir ? await docsDir.getFile(doc.filename, false) : null;
    if (!file) return null;
    return { bytes: await file.read(), doc };
  }
}
