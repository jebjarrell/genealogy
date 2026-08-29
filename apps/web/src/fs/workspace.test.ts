import { describe, it, expect, beforeEach } from 'vitest';
import { MemDir } from './memfs.js';
import { Workspace } from './workspace.js';
import { parseProject, serializeProject, newProject } from './project.js';
import { sha256Hex } from './hash.js';

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
    const res = await ws.addDocument(
      bytes('%PDF-1.4 cert'),
      'birth.pdf',
      'application/pdf',
    );
    expect(res).not.toBeNull();
    expect(res!.deduped).toBe(false);
    expect(res!.doc.mimetype).toBe('application/pdf');
    expect(res!.doc.filename.endsWith('.pdf')).toBe(true);
    expect(await ws.listDocuments()).toHaveLength(1);
  });

  it('dedupes identical bytes instead of storing a second copy', async () => {
    const a = await ws.addDocument(bytes('same'), 'first.png', 'image/png');
    const b = await ws.addDocument(bytes('same'), 'again.png', 'image/png');
    expect(b!.deduped).toBe(true);
    expect(b!.doc.docId).toBe(a!.doc.docId);
    expect(await ws.listDocuments()).toHaveLength(1);
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
    // A folder with no project.json - e.g. one the user created by hand.
    const projects = await ws.root.getDir('projects', true);
    await projects!.getDir('Empty', true);
    expect(await ws.listProjectSummaries()).toEqual([
      { name: 'Good', sourceHash: 'aaa' },
    ]);
  });

  // Regression test (final review, 5a): readSummary used to fall back to the
  // temp file only when project.json was *absent*, while openProject also fell
  // back when it was present but unparseable. writeProjectFile truncates
  // project.json on open, so a drive that drops out mid-write leaves exactly
  // that state: a 0-byte project.json beside a complete .tmp. A null summary
  // makes the autosave's "is this folder project mine?" guard skip entirely,
  // and our op-log gets written beside a stranger's source.ged.
  it('summarizes from the temp file when project.json is present but truncated', async () => {
    const ws = new Workspace(new MemDir());
    await ws.createProject('Interrupted', GED, 'i.ged', 'good-hash');
    const projects = await ws.root.getDir('projects', false);
    const dir = await projects!.getDir('Interrupted', false);
    // Exactly what a drive disconnect between truncate and write leaves behind.
    const tmp = await dir!.getFile('project.json.tmp', true);
    await tmp!.write(
      serializeProject(newProject('Interrupted', 'i.ged', 'source.ged', 'good-hash')),
    );
    const main = await dir!.getFile('project.json', true);
    await main!.write('');

    expect(await ws.projectSummary('Interrupted')).toEqual({
      name: 'Interrupted',
      sourceHash: 'good-hash',
    });
    // ...and the same recovery openProject already had.
    expect((await ws.openProject('Interrupted'))!.project.sourceHash).toBe('good-hash');
  });

  it('skips malformed project.json when summarizing', async () => {
    const ws = new Workspace(new MemDir());
    await ws.createProject('Good', GED, 'g.ged', 'bbb');
    // A folder with broken project.json - parseProject returns null on bad JSON.
    const projects = await ws.root.getDir('projects', true);
    const badDir = await projects!.getDir('Bad', true);
    const badFile = await badDir!.getFile('project.json', true);
    await badFile!.write('{not valid json}');
    expect(await ws.listProjectSummaries()).toEqual([
      { name: 'Good', sourceHash: 'bbb' },
    ]);
  });
});

describe('Workspace — compareSource (is this folder project mine?)', () => {
  let ws: Workspace;
  beforeEach(() => {
    ws = new Workspace(new MemDir());
  });

  it('reports absent when no such project folder exists', async () => {
    expect(await ws.compareSource('Nope', 'h1')).toBe('absent');
  });

  it('matches a declared hash and rejects a different one', async () => {
    await ws.createProject('P', GED, 'p.ged', 'h1');
    expect(await ws.compareSource('P', 'h1')).toBe('match');
    expect(await ws.compareSource('P', 'h2')).toBe('differs');
  });

  // A declared '' is the pre-hash placeholder: UNKNOWN, not "matches anything".
  // Settled from the bytes on disk so a legacy copy of our own project is still
  // recognised as ours (and keeps mirroring) while a stranger's is not.
  it("settles a declared '' hash from the bytes on disk, both ways", async () => {
    await ws.createProject('Legacy', GED, 'l.ged'); // hash ''
    const real = await sha256Hex(GED);
    expect(await ws.compareSource('Legacy', real)).toBe('match');
    expect(await ws.compareSource('Legacy', 'not-the-same-tree')).toBe('differs');
  });

  it('recovers the declared hash from the temp file when project.json is truncated', async () => {
    await ws.createProject('P', GED, 'p.ged', 'h1');
    const projects = await ws.root.getDir('projects', false);
    const dir = await projects!.getDir('P', false);
    const tmp = await dir!.getFile('project.json.tmp', true);
    await tmp!.write(serializeProject(newProject('P', 'p.ged', 'source.ged', 'h1')));
    await (await dir!.getFile('project.json', true))!.write('');

    expect(await ws.compareSource('P', 'h1')).toBe('match');
    expect(await ws.compareSource('P', 'h2')).toBe('differs');
  });

  it('reports unknown when nothing in the folder identifies the tree', async () => {
    const projects = await ws.root.getDir('projects', true);
    await projects!.getDir('Handmade', true); // no project.json, no source.ged
    expect(await ws.compareSource('Handmade', 'h1')).toBe('unknown');
  });
});
