import { describe, it, expect, beforeEach } from 'vitest';
import { MemDir } from './memfs.js';
import { Workspace } from './workspace.js';
import { parseProject, serializeProject, newProject } from './project.js';

const bytes = (s: string) => new TextEncoder().encode(s);
const GED = bytes('0 HEAD\n0 @I1@ INDI\n1 NAME A /B/\n0 TRLR\n');

describe('Workspace — projects (File System Access logic via in-memory FS)', () => {
  let ws: Workspace;
  beforeEach(() => {
    ws = new Workspace(new MemDir());
  });

  it('creates, lists, opens, and round-trips a project', async () => {
    const project = await ws.createProject('Smith Family', GED, 'smith.ged');
    expect(project.name).toBe('Smith Family');
    expect(await ws.listProjects()).toEqual(['Smith Family']);

    const opened = await ws.openProject('Smith Family');
    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(opened!.gedcomBytes)).toContain('@I1@');
    expect(opened!.project.ops).toEqual([]);
  });

  it('saves op-log + checklist + settings and reloads them exactly', async () => {
    const project = await ws.createProject('P', GED, 'p.ged');
    const edited = {
      ...project,
      focalPersonId: 'I1',
      ops: [{ kind: 'editPerson' as const, personId: 'I1', notes: ['x'], at: 't' }],
      checklists: [
        { id: 'c1', societyId: 'sar', patriotId: 'I1', proofs: [], createdAt: 't' },
      ],
      settings: { orientation: 'horizontal' as const },
    };
    await ws.saveProject(edited);

    const opened = await ws.openProject('P');
    expect(opened!.project.focalPersonId).toBe('I1');
    expect(opened!.project.ops).toHaveLength(1);
    expect(opened!.project.checklists[0]!.id).toBe('c1');
    expect(opened!.project.settings.orientation).toBe('horizontal');
  });

  it('renames a project, preserving its contents', async () => {
    await ws.createProject('Old', GED, 'p.ged');
    const renamed = await ws.renameProject('Old', 'New');
    expect(renamed!.name).toBe('New');
    expect(await ws.listProjects()).toEqual(['New']);
    const opened = await ws.openProject('New');
    expect(new TextDecoder().decode(opened!.gedcomBytes)).toContain('@I1@');
  });

  it('deletes a project', async () => {
    await ws.createProject('Doomed', GED, 'p.ged');
    await ws.deleteProject('Doomed');
    expect(await ws.listProjects()).toEqual([]);
    expect(await ws.openProject('Doomed')).toBeNull();
  });

  it('recovers from the temp file when project.json is missing', async () => {
    await ws.createProject('P', GED, 'p.ged');
    // Simulate an interrupted write: only the temp file is present.
    const projectsDir = await ws.root.getDir('projects', false);
    const dir = await projectsDir!.getDir('P', false);
    const proj = newProject('P', 'p.ged');
    proj.focalPersonId = 'I1';
    const tmp = await dir!.getFile('project.json.tmp', true);
    await tmp!.write(serializeProject(proj));
    await dir!.removeEntry('project.json');

    const opened = await ws.openProject('P');
    expect(opened!.project.focalPersonId).toBe('I1');
  });
});

describe('Workspace — vault (content-hash dedup)', () => {
  let ws: Workspace;
  beforeEach(() => {
    ws = new Workspace(new MemDir());
  });

  it('adds a PDF and records it in the manifest', async () => {
    const res = await ws.addDocument(bytes('%PDF-1.4 cert'), 'birth.pdf', 'application/pdf');
    expect(res).not.toBeNull();
    expect(res!.deduped).toBe(false);
    expect(res!.doc.mimetype).toBe('application/pdf');
    expect(res!.doc.filename.endsWith('.pdf')).toBe(true);
    expect((await ws.listDocuments())).toHaveLength(1);
  });

  it('dedupes identical bytes instead of storing a second copy', async () => {
    const a = await ws.addDocument(bytes('same'), 'first.png', 'image/png');
    const b = await ws.addDocument(bytes('same'), 'again.png', 'image/png');
    expect(b!.deduped).toBe(true);
    expect(b!.doc.docId).toBe(a!.doc.docId);
    expect((await ws.listDocuments())).toHaveLength(1);
  });

  it('rejects unsupported file types', async () => {
    expect(await ws.addDocument(bytes('x'), 'notes.txt', 'text/plain')).toBeNull();
  });

  it('persists citation links and reads document bytes back', async () => {
    const res = await ws.addDocument(bytes('jpegdata'), 'p.jpg', 'image/jpeg');
    await ws.setDocumentLinks(res!.doc.docId, ['sar:c1:I1->I2', 'sar:c1:I1->I2']);
    const docs = await ws.listDocuments();
    expect(docs[0]!.citationLinks).toEqual(['sar:c1:I1->I2']); // deduped

    const read = await ws.readDocument(res!.doc.docId);
    expect(new TextDecoder().decode(read!.bytes)).toBe('jpegdata');
  });
});

describe('project (de)serialization', () => {
  it('round-trips through JSON and rejects foreign files', () => {
    const p = newProject('P', 'p.ged');
    const back = parseProject(serializeProject(p));
    expect(back!.name).toBe('P');
    expect(parseProject('{"format":"something-else"}')).toBeNull();
    expect(parseProject('not json')).toBeNull();
  });
});
