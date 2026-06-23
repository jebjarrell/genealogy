import type { EditOp, Proof } from '@genealogy/core';

// The persisted shape of a project (handoff §2). A project is a folder on disk
// containing the GEDCOM source, the full op-log (merges + manual edits), the SAR
// checklist objects, the focal choice, and view settings. Everything here is
// plain JSON, human-readable and inspectable in Explorer/Finder.

export type PedigreeOrientation = 'vertical' | 'horizontal';

export interface ProjectSettings {
  /** Dagre layout direction for the pedigree view (handoff §6). */
  orientation: PedigreeOrientation;
}

export interface SarChecklistState {
  id: string;
  societyId: string;
  /** The person chosen as the patriot ancestor. */
  patriotId: string;
  /** Recorded proofs (document links + record-copy tie-ins). */
  proofs: Proof[];
  createdAt: string;
}

export interface ProjectFile {
  format: 'genealogy-graph/project';
  version: 1;
  name: string;
  /** Filename of the GEDCOM stored beside this file in the project folder. */
  sourceFile: string;
  /** The original upload filename, for display and export naming. */
  sourceFileName: string;
  focalPersonId: string | null;
  /** Unified edit op-log: merges + manual add/edit, replayed over the source. */
  ops: EditOp[];
  checklists: SarChecklistState[];
  settings: ProjectSettings;
  updatedAt: string;
}

export const DEFAULT_SETTINGS: ProjectSettings = { orientation: 'vertical' };

/** A fresh project record for a newly-imported GEDCOM. */
export function newProject(
  name: string,
  sourceFileName: string,
  sourceFile = 'source.ged',
): ProjectFile {
  return {
    format: 'genealogy-graph/project',
    version: 1,
    name,
    sourceFile,
    sourceFileName,
    focalPersonId: null,
    ops: [],
    checklists: [],
    settings: { ...DEFAULT_SETTINGS },
    updatedAt: new Date().toISOString(),
  };
}

export function serializeProject(project: ProjectFile): string {
  return JSON.stringify(project, null, 2);
}

/**
 * Parse a project.json string defensively. Returns null on anything that is not
 * a recognizable project record, and fills in any missing optional fields so an
 * older/partial file still loads.
 */
export function parseProject(text: string): ProjectFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<ProjectFile>;
  if (r.format !== 'genealogy-graph/project') return null;
  return {
    format: 'genealogy-graph/project',
    version: 1,
    name: typeof r.name === 'string' ? r.name : 'Untitled',
    sourceFile: typeof r.sourceFile === 'string' ? r.sourceFile : 'source.ged',
    sourceFileName:
      typeof r.sourceFileName === 'string' ? r.sourceFileName : 'source.ged',
    focalPersonId: typeof r.focalPersonId === 'string' ? r.focalPersonId : null,
    ops: Array.isArray(r.ops) ? (r.ops as EditOp[]) : [],
    checklists: Array.isArray(r.checklists)
      ? (r.checklists as SarChecklistState[])
      : [],
    settings: {
      orientation:
        r.settings?.orientation === 'horizontal' ? 'horizontal' : 'vertical',
    },
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
  };
}
