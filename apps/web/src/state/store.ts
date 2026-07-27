import { create } from 'zustand';
import {
  applyOps,
  buildGraph,
  detectPedigreeCollapse,
  enumerateRelationshipPaths,
  getEgoNetwork,
  getSiblings,
  expandPerson,
  parseGedcom,
  type CollapsePoint,
  type EditOp,
  type EventType,
  type GenealogyModel,
  type Graph,
  type GraphView,
  type ParseWarning,
  type Path,
  type Person,
  type Proof,
  type Sex,
} from '@genealogy/core';
import { buildView, focalGenerations, pathsToHighlight } from './viewModel.js';
import { Workspace } from '../fs/workspace.js';
import { dirFromHandle, hasPermission, requestPermissionInteractive, pickDirectory } from '../fs/fsa.js';
import { saveHandle, loadHandle, clearHandle } from '../fs/handleStore.js';
import { sha256Hex } from '../fs/hash.js';
import { sanitizeProjectName, uniqueProjectName } from '../fs/projectName.js';
import {
  IdbSessionStore,
  requestPersistentStorage,
  type SessionStore,
} from '../fs/sessionStore.js';
import {
  DEFAULT_SETTINGS,
  type PedigreeOrientation,
  type ProjectSettings,
  type SarChecklistState,
} from '../fs/project.js';
import type { VaultDoc } from '../fs/vault.js';
import {
  SaveScheduler,
  toProjectFile,
  type FolderStatus,
  type SaveSnapshot,
  type SaveStatus,
} from './persistence.js';

export const NODE_BUDGET = 300;

/** Per-session display options for the ego network. Defaults = direct ancestors. */
export interface ViewOptions {
  ancestorGenerations: number;
  descendantGenerations: number;
  includeSpouses: boolean;
  showMarriageEdges: boolean;
  showSiblings: boolean;
}

const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  ancestorGenerations: 4,
  descendantGenerations: 0,
  includeSpouses: false,
  showMarriageEdges: false,
  showSiblings: false,
};
export { DEFAULT_VIEW_OPTIONS };

export interface Highlight {
  fromId: string;
  toId: string;
  paths: Path[];
  truncated: boolean;
  nodeIds: Set<string>;
  edgeKeys: Set<string>;
}

// ---- Autosave ------------------------------------------------------------
// One scheduler for the app's lifetime. It pulls a snapshot from the store on
// each run rather than capturing state at schedule time, so a burst of edits
// coalesces into a single write of the latest state.

let scheduler: SaveScheduler | null = null;

function snapshotOf(s: AppState): SaveSnapshot | null {
  // A falsy sourceHash ('' or null) is not a real content hash - it is the
  // "unknown" placeholder ProjectFile documents for pre-existing records. That
  // placeholder must never be treated as a key into the content-addressed
  // source store: two different projects with an unknown hash would collide
  // on the same '' key, and the second putSource() would be skipped as
  // "already stored", leaving its record pointing at the first project's
  // GEDCOM bytes. Refusing to save is strictly better than saving under a
  // colliding key.
  if (!s.projectName || !s.baseModel || !s.sourceHash) return null;
  return {
    record: {
      name: s.projectName,
      sourceHash: s.sourceHash,
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
function persist(_get: () => AppState): void {
  scheduler?.schedule();
}

// ---- Survivor mapping (ids that may have been merged away) --------------

function survivorMap(ops: EditOp[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const op of ops) if (op.kind === 'merge') m.set(op.mergeId, op.keepId);
  return m;
}
function survivorOf(
  id: string | null,
  byMerge: Map<string, string>,
  model: GenealogyModel,
): string | null {
  if (!id) return null;
  let cur = id;
  const seen = new Set<string>();
  while (!model.persons.has(cur) && byMerge.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = byMerge.get(cur)!;
  }
  return model.persons.has(cur) ? cur : null;
}

/** Next free id of the form `<prefix><n>` among the given existing ids. */
function nextId(existing: Iterable<string>, prefix: string): string {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const id of existing) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number.parseInt(m[1]!, 10));
  }
  return `${prefix}${max + 1}`;
}

interface InternalState {
  model: GenealogyModel | null;
  graph: Graph | null;
  collapseSet: Set<string>;
  genMap: Map<string, number>;
  viewIds: Set<string>;
}

export interface PersonInput {
  nameRaws: string[];
  sex: Sex;
  notes?: string[];
}
export interface EventInput {
  eventType: EventType;
  participantIds: string[];
  dateRaw?: string;
  placeRaw?: string;
  description?: string;
  familyId?: string;
}

export interface AppState extends InternalState {
  baseModel: GenealogyModel | null;
  /** Unified edit op-log (merges + manual add/edit), replayed over baseModel. */
  ops: EditOp[];
  /** Undone ops available to redo. */
  redoStack: EditOp[];
  fileName: string | null;
  /** Raw GEDCOM bytes of the loaded source, for "save as project" + export. */
  sourceBytes: Uint8Array | null;
  focalPersonId: string | null;
  view: GraphView | null;
  collapsePoints: CollapsePoint[];
  warnings: ParseWarning[];
  detailPersonId: string | null;
  selectedIds: string[];
  highlight: Highlight | null;
  notice: string | null;
  viewOptions: ViewOptions;
  focalPickerOpen: boolean;
  mergeOpen: boolean;
  mapAncestorId: string | null;

  // ---- persistence / workspace ----
  workspace: Workspace | null;
  workspaceName: string | null;
  projects: string[];
  projectName: string | null;
  /** Content hash of the open project's GEDCOM. */
  sourceHash: string | null;
  projectCreatedAt: string | null;
  folderStatus: FolderStatus;
  reconnectWorkspace: () => Promise<void>;
  backfillFolder: () => Promise<void>;
  session: SessionStore | null;
  saveState: { status: SaveStatus; lastSavedAt: string | null };
  vaultDocs: VaultDoc[];
  checklists: SarChecklistState[];
  settings: ProjectSettings;

  // ---- session lifecycle ----
  setSessionStore: (store: SessionStore | null) => void;
  importGedcom: (bytes: Uint8Array, fileName: string) => Promise<void>;
  restoreSession: () => Promise<void>;
  flushSaves: () => Promise<void>;

  // ---- model loading ----
  loadModel: (model: GenealogyModel, fileName: string, sourceBytes?: Uint8Array) => void;
  setFocal: (personId: string) => void;
  selectPerson: (personId: string) => void;
  deselectPerson: (personId: string) => void;
  clearSelection: () => void;
  expand: (personId: string, direction: 'ancestors' | 'descendants' | 'all') => void;
  showRelationship: (fromId: string, toId: string) => void;
  clearHighlight: () => void;
  resetView: () => void;
  setViewOptions: (partial: Partial<ViewOptions>) => void;
  openFocalPicker: () => void;
  closeFocalPicker: () => void;
  openMerge: () => void;
  closeMerge: () => void;
  setMapAncestor: (personId: string | null) => void;
  search: (query: string) => Person[];
  dismissWarnings: () => void;

  // ---- edit layer (op-log) ----
  mergePeople: (keepId: string, mergeId: string) => void;
  /** Remove the op at `index`; pushes to the redo stack when it is the last op. */
  undoOp: (index: number) => void;
  /** Alias kept for the Review list. */
  undoMerge: (index: number) => void;
  redo: () => void;
  addPerson: (input: PersonInput) => string | null;
  editPerson: (personId: string, input: PersonInput) => void;
  addEvent: (input: EventInput) => string | null;
  editEvent: (
    eventId: string,
    patch: { eventType?: EventType; dateRaw?: string | null; placeRaw?: string | null; description?: string | null },
  ) => void;
  linkRelationship: (
    relation: 'parent-child' | 'spouse',
    ids: { parentId?: string; childId?: string; spouseAId?: string; spouseBId?: string },
  ) => void;
  unlinkRelationship: (familyId: string, relation: 'parent-child' | 'spouse', ids: { parentId?: string; childId?: string; spouseAId?: string; spouseBId?: string }) => void;

  // ---- pedigree orientation ----
  setOrientation: (orientation: PedigreeOrientation) => void;

  // ---- workspace / projects / vault ----
  connectWorkspace: () => Promise<void>;
  restoreWorkspace: () => Promise<void>;
  disconnectWorkspace: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshVault: () => Promise<void>;
  openProjectByName: (name: string) => Promise<void>;
  renameCurrentProject: (name: string) => Promise<void>;
  deleteProjectByName: (name: string) => Promise<void>;
  addVaultDocument: (file: File) => Promise<{ deduped: boolean; name: string } | null>;

  // ---- SAR checklists ----
  createChecklist: (patriotId: string) => string;
  deleteChecklist: (id: string) => void;
  addChecklistProof: (id: string, proof: Proof) => void;
  removeChecklistProof: (id: string, index: number) => void;
  linkDocumentToChecklist: (id: string, linkKey: string, docId: string) => void;
}

const emptyInternal: InternalState = {
  model: null,
  graph: null,
  collapseSet: new Set(),
  genMap: new Map(),
  viewIds: new Set(),
};

function baseViewIds(
  graph: Graph,
  model: GenealogyModel,
  focalId: string,
  options: ViewOptions,
): Set<string> {
  const ego = getEgoNetwork(graph, model, focalId, {
    ancestorGenerations: options.ancestorGenerations,
    descendantGenerations: options.descendantGenerations,
    includeSpouses: options.includeSpouses,
    nodeBudget: NODE_BUDGET,
  });
  const ids = new Set(ego.nodes.map((n) => n.person.id));
  if (options.showSiblings) {
    for (const id of [...ids]) {
      if (ids.size >= NODE_BUDGET) break;
      for (const sib of getSiblings(graph, id)) {
        if (ids.size >= NODE_BUDGET) break;
        ids.add(sib);
      }
    }
  }
  return ids;
}

function deriveFocalState(
  graph: Graph,
  model: GenealogyModel,
  focalId: string,
  options: ViewOptions,
): Pick<AppState, 'collapsePoints' | 'collapseSet' | 'genMap' | 'viewIds' | 'view'> {
  const collapsePoints = detectPedigreeCollapse(graph, focalId);
  const collapseSet = new Set(collapsePoints.map((c) => c.ancestorId));
  const genMap = focalGenerations(graph, focalId);
  const viewIds = baseViewIds(graph, model, focalId, options);
  return {
    collapsePoints,
    collapseSet,
    genMap,
    viewIds,
    view: buildView(graph, model, focalId, collapseSet, genMap, viewIds),
  };
}

export const useStore = create<AppState>((set, get) => {
  /**
   * Replay an op-log over the base model and refresh all derived state, mapping
   * the focal/detail/map selections through any merges and preserving the
   * visible node set where possible. The single path through which every edit,
   * merge, undo, and redo updates the model (op-log fidelity, TRD §8.2).
   */
  const applyOpLog = (
    nextOps: EditOp[],
    redoStack: EditOp[],
    opts?: { addedIds?: string[]; focusId?: string; notice?: string | null },
  ): void => {
    const { baseModel, focalPersonId, viewOptions, viewIds, detailPersonId, mapAncestorId } =
      get();
    if (!baseModel) return;
    const model = applyOps(baseModel, nextOps);
    const graph = buildGraph(model);
    const byMerge = survivorMap(nextOps);
    const focal = survivorOf(focalPersonId, byMerge, model);

    let derived: Pick<
      AppState,
      'collapsePoints' | 'collapseSet' | 'genMap' | 'viewIds' | 'view'
    >;
    if (focal) {
      const collapsePoints = detectPedigreeCollapse(graph, focal);
      const collapseSet = new Set(collapsePoints.map((c) => c.ancestorId));
      const genMap = focalGenerations(graph, focal);
      let nextViewIds: Set<string>;
      if (viewIds.size === 0) {
        nextViewIds = baseViewIds(graph, model, focal, viewOptions);
      } else {
        nextViewIds = new Set<string>();
        for (const id of viewIds) {
          const s = survivorOf(id, byMerge, model);
          if (s) nextViewIds.add(s);
        }
        nextViewIds.add(focal);
        for (const id of opts?.addedIds ?? []) if (model.persons.has(id)) nextViewIds.add(id);
      }
      derived = {
        collapsePoints,
        collapseSet,
        genMap,
        viewIds: nextViewIds,
        view: buildView(graph, model, focal, collapseSet, genMap, nextViewIds),
      };
    } else {
      derived = {
        collapsePoints: [],
        collapseSet: new Set(),
        genMap: new Map(),
        viewIds: new Set(),
        view: null,
      };
    }

    set({
      ops: nextOps,
      redoStack,
      model,
      graph,
      focalPersonId: focal,
      ...derived,
      detailPersonId:
        opts?.focusId ?? survivorOf(detailPersonId, byMerge, model) ?? focal ?? null,
      mapAncestorId: survivorOf(mapAncestorId, byMerge, model),
      selectedIds: [],
      highlight: null,
      ...(opts && 'notice' in opts ? { notice: opts.notice ?? null } : {}),
    });
    persist(get);
  };

  return {
    ...emptyInternal,
    baseModel: null,
    ops: [],
    redoStack: [],
    fileName: null,
    sourceBytes: null,
    focalPersonId: null,
    view: null,
    collapsePoints: [],
    warnings: [],
    detailPersonId: null,
    selectedIds: [],
    highlight: null,
    notice: null,
    viewOptions: DEFAULT_VIEW_OPTIONS,
    focalPickerOpen: false,
    mergeOpen: false,
    mapAncestorId: null,
    workspace: null,
    workspaceName: null,
    projects: [],
    projectName: null,
    sourceHash: null,
    projectCreatedAt: null,
    folderStatus: 'none',
    session: typeof indexedDB !== 'undefined' ? new IdbSessionStore() : null,
    saveState: { status: 'idle', lastSavedAt: null },
    vaultDocs: [],
    checklists: [],
    settings: { ...DEFAULT_SETTINGS },

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
        // Loading a loose file leaves any bound workspace, but clears the project.
        projectName: null,
        sourceHash: null,
      });

      if (model.persons.size === 0) {
        set({ notice: 'No individuals found in this file.' });
        return;
      }
      const declared = model.header?.rootPersonId;
      if (declared && model.persons.has(declared)) get().setFocal(declared);
      else set({ focalPickerOpen: true });
    },

    setFocal: (personId) => {
      const { graph, model, viewOptions } = get();
      if (!graph || !model) return;
      set({
        focalPersonId: personId,
        ...deriveFocalState(graph, model, personId, viewOptions),
        detailPersonId: personId,
        selectedIds: [],
        highlight: null,
        notice: null,
        focalPickerOpen: false,
        mapAncestorId: null,
      });
      persist(get);
    },

    selectPerson: (personId) =>
      set((s) => {
        const selectedIds = s.selectedIds.includes(personId)
          ? s.selectedIds.filter((id) => id !== personId)
          : [...s.selectedIds, personId].slice(-2);
        return { detailPersonId: personId, selectedIds };
      }),

    deselectPerson: (personId) =>
      set((s) => ({ selectedIds: s.selectedIds.filter((id) => id !== personId) })),

    clearSelection: () => set({ selectedIds: [] }),

    expand: (personId, direction) => {
      const { graph, model, focalPersonId, collapseSet, genMap, viewIds } = get();
      if (!graph || !model || !focalPersonId) return;
      const view = get().view;
      if (!view) return;
      const { addedNodes } = expandPerson(graph, model, view, personId, direction);
      if (addedNodes.length === 0) {
        set({ notice: 'No more neighbours to reveal here.' });
        return;
      }
      const nextIds = new Set(viewIds);
      for (const n of addedNodes) nextIds.add(n.person.id);
      const overBudget = nextIds.size > NODE_BUDGET;
      set({
        viewIds: nextIds,
        view: buildView(graph, model, focalPersonId, collapseSet, genMap, nextIds),
        notice: overBudget
          ? `Showing ${nextIds.size} people — past the ${NODE_BUDGET}-node budget; the graph may get dense.`
          : null,
      });
    },

    showRelationship: (fromId, toId) => {
      const { graph, model, focalPersonId, collapseSet, genMap, viewIds } = get();
      if (!graph || !model || !focalPersonId) return;
      const { paths, truncated } = enumerateRelationshipPaths(graph, fromId, toId);
      const { nodeIds, edgeKeys } = pathsToHighlight(paths);
      const nextIds = new Set(viewIds);
      for (const id of nodeIds) nextIds.add(id);
      set({
        viewIds: nextIds,
        view: buildView(graph, model, focalPersonId, collapseSet, genMap, nextIds),
        highlight: { fromId, toId, paths, truncated, nodeIds, edgeKeys },
      });
    },

    clearHighlight: () => set({ highlight: null }),

    resetView: () => {
      const { focalPersonId } = get();
      if (focalPersonId) get().setFocal(focalPersonId);
    },

    setViewOptions: (partial) => {
      const { graph, model, focalPersonId, collapseSet, genMap, viewOptions, highlight } =
        get();
      const next = { ...viewOptions, ...partial };
      if (!graph || !model || !focalPersonId) {
        set({ viewOptions: next });
        return;
      }
      const ids = baseViewIds(graph, model, focalPersonId, next);
      if (highlight) for (const id of highlight.nodeIds) ids.add(id);
      set({
        viewOptions: next,
        viewIds: ids,
        view: buildView(graph, model, focalPersonId, collapseSet, genMap, ids),
      });
    },

    openFocalPicker: () => set({ focalPickerOpen: true }),
    closeFocalPicker: () => set({ focalPickerOpen: false }),
    openMerge: () => set({ mergeOpen: true }),
    closeMerge: () => set({ mergeOpen: false }),
    setMapAncestor: (personId) => set({ mapAncestorId: personId }),

    search: (query) => {
      const { model } = get();
      if (!model) return [];
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const results: Person[] = [];
      for (const person of model.persons.values()) {
        const hit = person.names.some((n) =>
          [n.full, n.given, n.surname, n.raw].some((s) => s?.toLowerCase().includes(q)),
        );
        if (hit) results.push(person);
        if (results.length >= 50) break;
      }
      return results;
    },

    dismissWarnings: () => set({ warnings: [] }),

    // ---- edit layer ----

    mergePeople: (keepId, mergeId) => {
      const { ops } = get();
      if (keepId === mergeId) return;
      applyOpLog(
        [...ops, { kind: 'merge', keepId, mergeId, at: new Date().toISOString() }],
        [],
        { focusId: keepId, notice: 'Merged. Undo it any time from the Review tab.', addedIds: [keepId] },
      );
      set({ mergeOpen: false });
    },

    undoOp: (index) => {
      const { ops } = get();
      if (index < 0 || index >= ops.length) return;
      const removed = ops[index]!;
      const nextOps = ops.filter((_, i) => i !== index);
      const redoStack = index === ops.length - 1 ? [...get().redoStack, removed] : [];
      applyOpLog(nextOps, redoStack, { notice: 'Edit undone.' });
    },

    undoMerge: (index) => get().undoOp(index),

    redo: () => {
      const { ops, redoStack } = get();
      if (redoStack.length === 0) return;
      const op = redoStack[redoStack.length - 1]!;
      applyOpLog([...ops, op], redoStack.slice(0, -1), { notice: 'Edit redone.' });
    },

    addPerson: (input) => {
      const { model, ops } = get();
      if (!model) return null;
      const personId = nextId(model.persons.keys(), 'U');
      const op: EditOp = {
        kind: 'addPerson',
        personId,
        nameRaws: input.nameRaws,
        sex: input.sex,
        at: new Date().toISOString(),
        ...(input.notes && input.notes.length > 0 ? { notes: input.notes } : {}),
      };
      applyOpLog([...ops, op], [], {
        addedIds: [personId],
        focusId: personId,
        notice: 'Person added (user-supplied).',
      });
      return personId;
    },

    editPerson: (personId, input) => {
      const { ops } = get();
      const op: EditOp = {
        kind: 'editPerson',
        personId,
        nameRaws: input.nameRaws,
        sex: input.sex,
        at: new Date().toISOString(),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      };
      applyOpLog([...ops, op], [], { focusId: personId, notice: 'Person updated.' });
    },

    addEvent: (input) => {
      const { model, ops } = get();
      if (!model) return null;
      const eventId = nextId(model.events.keys(), 'EVU');
      const op: EditOp = {
        kind: 'addEvent',
        eventId,
        eventType: input.eventType,
        participantIds: input.participantIds,
        at: new Date().toISOString(),
        ...(input.dateRaw ? { dateRaw: input.dateRaw } : {}),
        ...(input.placeRaw ? { placeRaw: input.placeRaw } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.familyId ? { familyId: input.familyId } : {}),
      };
      const focus = input.participantIds[0];
      applyOpLog([...ops, op], [], {
        ...(focus ? { focusId: focus } : {}),
        notice: 'Event added.',
      });
      return eventId;
    },

    editEvent: (eventId, patch) => {
      const { ops } = get();
      const op: EditOp = { kind: 'editEvent', eventId, at: new Date().toISOString(), ...patch };
      applyOpLog([...ops, op], [], { notice: 'Event updated.' });
    },

    linkRelationship: (relation, ids) => {
      const { model, ops } = get();
      if (!model) return;
      const familyId = nextId(model.families.keys(), 'FU');
      const op: EditOp = {
        kind: 'linkRelationship',
        relation,
        familyId,
        at: new Date().toISOString(),
        ...ids,
      };
      const focus = ids.childId ?? ids.parentId ?? ids.spouseAId;
      applyOpLog([...ops, op], [], {
        ...(focus ? { focusId: focus } : {}),
        notice: 'Relationship linked.',
      });
    },

    unlinkRelationship: (familyId, relation, ids) => {
      const { ops } = get();
      const op: EditOp = {
        kind: 'unlinkRelationship',
        relation,
        familyId,
        at: new Date().toISOString(),
        ...ids,
      };
      applyOpLog([...ops, op], [], { notice: 'Relationship unlinked.' });
    },

    setOrientation: (orientation) => {
      set((s) => ({ settings: { ...s.settings, orientation } }));
      persist(get);
    },

    // ---- session lifecycle ----

    setSessionStore: (store) => set({ session: store }),

    flushSaves: async () => {
      await scheduler?.flush();
    },

    importGedcom: async (bytes, fileName) => {
      // Flush whatever project is currently open before we start reassigning
      // state out from under it. The scheduler snapshots at *run* time, so an
      // outgoing project's pending debounce would otherwise silently get
      // repointed at the incoming one by the `persist(get)` below (which just
      // reschedules the same timer) - discarding, not deferring, any edit
      // made in the last 300ms/1s.
      await get().flushSaves();

      const hash = await sha256Hex(bytes);
      const { session, workspace } = get();

      // 1. Same bytes already imported? Reopen, keeping every edit.
      const records = session ? await session.listProjects() : [];
      const sessionHit = records.find((r) => r.sourceHash === hash);
      if (sessionHit) {
        await get().openProjectByName(sessionHit.name);
        // openProjectByName has a real failure path (bad/missing project);
        // only claim success if the open actually landed - otherwise leave
        // its own failure notice in place rather than paving over it.
        if (get().projectName === sessionHit.name) {
          set({ notice: `Reopened "${sessionHit.name}".` });
        }
        return;
      }
      if (workspace) {
        const summaries = await workspace.listProjectSummaries();
        const folderHit = summaries.find((p) => p.sourceHash === hash);
        if (folderHit) {
          await get().openProjectByName(folderHit.name);
          if (get().projectName === folderHit.name) {
            set({ notice: `Reopened "${folderHit.name}".` });
          }
          return;
        }
      }

      // 2. New content: create a project named from the file. Seed `taken`
      // with the project currently open (it may not appear in `records` or a
      // folder listing yet - nothing has autosaved it there) and a *fresh*
      // folder name listing rather than the cached `projects`, which can lag
      // a folder create still sitting behind its own debounce. Without both,
      // two different files that happen to share a name can be assigned the
      // same project name, and the second autosave silently overwrites the
      // first project's op-log and source hash while its GEDCOM stays on disk.
      const currentName = get().projectName;
      const folderNames = workspace ? await workspace.listProjects() : get().projects;
      const taken = [
        ...records.map((r) => r.name),
        ...folderNames,
        ...(currentName ? [currentName] : []),
      ];
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

    /**
     * Cold start. Two independent halves: the project restores from the session
     * store with no permission and no user gesture, and the folder rebinds
     * opportunistically. A restored project renders whether or not the folder
     * comes back, so the folder half runs second and is wrapped - nothing it
     * does (or fails to do) may undo or abort the restore above it.
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
          // Pointer survived but the bytes did not - clear it so the next boot
          // starts clean instead of hitting this every time.
          await session.setLastProject(null);
          set({ notice: `Project "${record.name}" could not be restored — its source is missing.` });
        } else if (lastName) {
          // Pointer to a record that is no longer there at all. Nothing worth
          // telling the user (the project is simply gone), but the dangling
          // pointer must not survive to the next boot.
          await session.setLastProject(null);
        }
        // The project list has to be populated here, not by the folder half:
        // with no folder ever connected, restoreWorkspace returns at its
        // 'none' branch and backfillFolder is skipped, so nothing else would
        // ever list the browser-only projects this union exists for.
        await get().refreshProjects();
      }

      try {
        await get().restoreWorkspace();
        if (get().workspace) await get().backfillFolder();
      } catch {
        // The folder is opportunistic. A throw here (revoked handle, unplugged
        // drive) is a folder status change, never a failed restore.
        set({ folderStatus: 'error' });
      }
    },

    // ---- workspace / projects / vault ----

    connectWorkspace: async () => {
      const handle = await pickDirectory();
      if (!handle) return;
      if (!(await requestPermissionInteractive(handle))) {
        set({ notice: 'Permission to the workspace folder was denied.' });
        return;
      }
      await saveHandle(handle);
      const ws = new Workspace(dirFromHandle(handle));
      set({
        workspace: ws,
        workspaceName: (handle as { name?: string }).name ?? 'workspace',
        folderStatus: 'connected',
        notice: 'Workspace connected.',
      });
      await get().refreshProjects();
      await get().refreshVault();
    },

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

    /**
     * Mirror any project that exists only in the browser to the bound folder.
     * Runs after a folder is connected or rebound: the session store is the
     * authoritative copy, so the folder is brought up to it, never the reverse.
     * A project already on disk is left completely alone - the folder copy may
     * be the newer one, and this is a backfill, not a sync.
     */
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

    disconnectWorkspace: async () => {
      await clearHandle();
      // Disconnecting stops the folder *mirror*, not the browser copy: the
      // open project (and its autosave to the session store) must keep
      // running, or every edit made after this point is silently lost.
      set({
        workspace: null,
        workspaceName: null,
        folderStatus: 'none',
        vaultDocs: [],
      });
      // Projects also live in the browser now; re-derive the list from the
      // session store rather than assuming disconnecting the folder empties it.
      await get().refreshProjects();
    },

    refreshProjects: async () => {
      const { workspace, session } = get();
      const names = new Set<string>();
      // Union of both backends: a project can exist only in the browser (no
      // folder ever connected) or only on disk (written by another machine).
      // Guarded separately on purpose - a broken folder must not hide the
      // browser's own projects, which are the authoritative copy.
      try {
        if (workspace) for (const n of await workspace.listProjects()) names.add(n);
      } catch {
        /* ignore - a partial list is better than none */
      }
      try {
        if (session) for (const r of await session.listProjects()) names.add(r.name);
      } catch {
        /* ignore - a partial list is better than none */
      }
      set({ projects: [...names].sort((a, b) => a.localeCompare(b)) });
    },

    refreshVault: async () => {
      const { workspace } = get();
      if (!workspace) return;
      try {
        set({ vaultDocs: await workspace.listDocuments() });
      } catch {
        /* ignore */
      }
    },

    openProjectByName: async (name) => {
      await get().flushSaves(); // don't lose pending edits on the outgoing project
      const { workspace, session } = get();

      // Prefer the browser copy: it is authoritative and needs no permission,
      // so a reopen works with no folder connected at all.
      const record = session ? await session.getProject(name) : null;
      const cached = record && session ? await session.getSource(record.sourceHash) : null;

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
        // Every exit from here sets a notice: a reopen that cannot proceed must
        // never look like nothing happened.
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
        // ProjectFile has no createdAt; its updatedAt is the best available
        // lower bound and only ever seeds a record that has none yet.
        createdAt = opened.project.updatedAt;
        // A folder project written before sourceHash existed carries ''.
        // snapshotOf refuses to autosave on a falsy hash, so without computing
        // one here the project would never save and would report no error.
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
        saveState: { status: 'idle', lastSavedAt: null },
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

      // Cache a folder-only project into the session store so the next cold
      // start restores it without the folder being present. Reached on both
      // paths: harmless re-save for one that was already there.
      persist(get);
      await get().refreshVault();
    },

    renameCurrentProject: async (name) => {
      const { projectName } = get();
      if (!projectName) return;
      // Settle any pending save under the OLD name and disarm both timers
      // first. A debounce firing partway through the renames below would write
      // the old record straight back, leaving a duplicate the rename just moved.
      await get().flushSaves();
      const { workspace, session } = get();
      const wsOk = workspace
        ? (await workspace.renameProject(projectName, name)) !== null
        : false;
      const sessionOk = session
        ? (await session.renameProject(projectName, name)) !== null
        : false;
      // Both backends refused (or there were none). Bail rather than adopt the
      // new name: persist() would then write a fresh record under it and leave
      // the surviving original beside it as a duplicate.
      if (!wsOk && !sessionOk) {
        set({ notice: `Could not rename "${projectName}".` });
        return;
      }
      set({ projectName: name, notice: `Renamed to "${name}".` });
      persist(get);
      await get().refreshProjects();
    },

    deleteProjectByName: async (name) => {
      const { workspace, session, projectName } = get();
      // Clear the open project BEFORE touching either backend: this makes
      // snapshotOf return null, so a save still sitting behind its debounce
      // cannot fire during the awaits below and resurrect the record.
      if (projectName === name) {
        set({ projectName: null, sourceHash: null, projectCreatedAt: null });
      }
      if (workspace) await workspace.deleteProject(name);
      if (session) {
        await session.deleteProject(name);
        // Never leave the next boot pointing at a record that is gone.
        if (projectName === name) await session.setLastProject(null);
      }
      await get().refreshProjects();
    },

    addVaultDocument: async (file) => {
      const { workspace } = get();
      if (!workspace) {
        set({ notice: 'Connect a workspace folder to use the vault.' });
        return null;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await workspace.addDocument(bytes, file.name, file.type);
      if (!result) {
        set({ notice: 'Unsupported file type — vault accepts PDF, JPG, and PNG.' });
        return null;
      }
      await get().refreshVault();
      set({
        notice: result.deduped
          ? 'That document is already in your vault — linked, not duplicated.'
          : `Added "${file.name}" to the vault.`,
      });
      return { deduped: result.deduped, name: result.doc.originalName };
    },

    // ---- SAR checklists ----

    createChecklist: (patriotId) => {
      const id = `chk-${Date.now().toString(36)}`;
      const checklist: SarChecklistState = {
        id,
        societyId: 'sar',
        patriotId,
        proofs: [],
        createdAt: new Date().toISOString(),
      };
      set((s) => ({ checklists: [...s.checklists, checklist], notice: 'Checklist created.' }));
      persist(get);
      return id;
    },

    deleteChecklist: (id) => {
      set((s) => ({ checklists: s.checklists.filter((c) => c.id !== id) }));
      persist(get);
    },

    addChecklistProof: (id, proof) => {
      set((s) => ({
        checklists: s.checklists.map((c) =>
          c.id === id ? { ...c, proofs: [...c.proofs, proof] } : c,
        ),
      }));
      persist(get);
    },

    removeChecklistProof: (id, index) => {
      set((s) => ({
        checklists: s.checklists.map((c) =>
          c.id === id ? { ...c, proofs: c.proofs.filter((_, i) => i !== index) } : c,
        ),
      }));
      persist(get);
    },

    linkDocumentToChecklist: (id, linkKey, docId) => {
      get().addChecklistProof(id, { kind: 'document', linkKey, docId });
      const { workspace } = get();
      if (workspace) {
        const ref = `sar:${id}:${linkKey}`;
        const doc = get().vaultDocs.find((d) => d.docId === docId);
        const links = [...(doc?.citationLinks ?? []), ref];
        void workspace.setDocumentLinks(docId, links).then(() => get().refreshVault());
      }
    },
  };
});

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
