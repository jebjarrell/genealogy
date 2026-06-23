// The document vault index (handoff §2). The vault is GLOBAL (shared across
// projects) so the same document — addressed by content hash — proves links in
// multiple SAR checklists without being stored twice. This module holds the pure
// index shape + helpers; the Workspace performs the actual file writes.

export type VaultMime = 'application/pdf' | 'image/jpeg' | 'image/png';

export interface VaultDoc {
  /** Content address = SHA-256 hex of the bytes. Natural dedup key. */
  docId: string;
  /** Stored filename under vault/documents/ (e.g. "<hash>.pdf"). */
  filename: string;
  /** The name the file had when uploaded. */
  originalName: string;
  hash: string;
  mimetype: string;
  size: number;
  addedAt: string;
  /** Opaque citation references this doc proves (e.g. "sar:<id>:<linkKey>"). */
  citationLinks: string[];
}

export interface VaultIndex {
  format: 'genealogy-graph/vault';
  version: 1;
  documents: VaultDoc[];
}

export function emptyVaultIndex(): VaultIndex {
  return { format: 'genealogy-graph/vault', version: 1, documents: [] };
}

export function serializeVaultIndex(index: VaultIndex): string {
  return JSON.stringify(index, null, 2);
}

export function parseVaultIndex(text: string): VaultIndex {
  try {
    const raw = JSON.parse(text) as Partial<VaultIndex>;
    if (raw && raw.format === 'genealogy-graph/vault' && Array.isArray(raw.documents)) {
      return { format: 'genealogy-graph/vault', version: 1, documents: raw.documents };
    }
  } catch {
    /* fall through to empty */
  }
  return emptyVaultIndex();
}

/** Accepted upload types → canonical mime + file extension. */
const ACCEPTED: Readonly<Record<string, { mime: VaultMime; ext: string }>> = {
  'application/pdf': { mime: 'application/pdf', ext: 'pdf' },
  'image/jpeg': { mime: 'image/jpeg', ext: 'jpg' },
  'image/jpg': { mime: 'image/jpeg', ext: 'jpg' },
  'image/png': { mime: 'image/png', ext: 'png' },
};

/** Validate an upload's mime type; returns canonical mime+ext or null if unsupported. */
export function classifyUpload(
  mimetype: string,
  filename: string,
): { mime: VaultMime; ext: string } | null {
  const byMime = ACCEPTED[mimetype.toLowerCase()];
  if (byMime) return byMime;
  // Fall back to the filename extension when the browser gives a vague mime.
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return { mime: 'application/pdf', ext: 'pdf' };
  if (ext === 'jpg' || ext === 'jpeg') return { mime: 'image/jpeg', ext: 'jpg' };
  if (ext === 'png') return { mime: 'image/png', ext: 'png' };
  return null;
}

export function findByHash(index: VaultIndex, hash: string): VaultDoc | undefined {
  return index.documents.find((d) => d.hash === hash);
}
