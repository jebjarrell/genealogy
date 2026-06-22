import { create } from 'zustand';
import {
  applyMerges,
  buildGraph,
  detectPedigreeCollapse,
  enumerateRelationshipPaths,
  getEgoNetwork,
  getSiblings,
  expandPerson,
  type CollapsePoint,
  type GenealogyModel,
  type Graph,
  type GraphView,
  type MergeOp,
  type ParseWarning,
  type Path,
  type Person,
} from '@genealogy/core';
import { buildView, focalGenerations, pathsToHighlight } from './viewModel.js';

export const NODE_BUDGET = 300;

/** Per-session display options for the ego network. Defaults = direct ancestors. */
export interface ViewOptions {
  ancestorGenerations: number;
  descendantGenerations: number;
  includeSpouses: boolean;
  showMarriageEdges: boolean;
  /** Add the siblings of everyone in view (off by default → direct ancestors). */
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

// Remember the chosen focal person per file (web-only convenience).
const rememberKey = (fileName: string) => `genealogy:focal:${fileName}`;
function rememberFocal(fileName: string | null, id: string): void {
  if (!fileName) return;
  try {
    localStorage.setItem(rememberKey(fileName), id);
  } catch {
    /* localStorage unavailable — ignore */
  }
}
function recallFocal(fileName: string): string | undefined {
  try {
    return localStorage.getItem(rememberKey(fileName)) ?? undefined;
  } catch {
    return undefined;
  }
}

// Persist the merge op-log per file (the edit layer). The pristine parsed model
// is never written; merges are replayed over it on load (originals are sacred).
const mergesKey = (fileName: string) => `genealogy:merges:${fileName}`;
function loadMerges(fileName: string | null): MergeOp[] {
  if (!fileName) return [];
  try {
    const raw = localStorage.getItem(mergesKey(fileName));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as MergeOp[]) : [];
  } catch {
    return [];
  }
}
function saveMerges(fileName: string | null, ops: MergeOp[]): void {
  if (!fileName) return;
  try {
    localStorage.setItem(mergesKey(fileName), JSON.stringify(ops));
  } catch {
    /* localStorage unavailable — ignore */
  }
}

/**
 * Map an id that may have been merged away to its surviving record. Follows the
 * mergeId→keepId chain; returns null if no survivor exists in the model.
 */
function survivorOf(
  id: string | null,
  ops: MergeOp[],
  model: GenealogyModel,
): string | null {
  if (!id) return null;
  if (model.persons.has(id)) return id;
  const byMerge = new Map(ops.map((op) => [op.mergeId, op.keepId]));
  let cur = id;
  const seen = new Set<string>();
  while (!model.persons.has(cur) && byMerge.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = byMerge.get(cur)!;
  }
  return model.persons.has(cur) ? cur : null;
}

interface InternalState {
  model: GenealogyModel | null;
  graph: Graph | null;
  collapseSet: Set<string>;
  genMap: Map<string, number>;
  viewIds: Set<string>;
}

export interface AppState extends InternalState {
  /** Pristine parsed model; the working `model` is `applyMerges(baseModel, merges)`. */
  baseModel: GenealogyModel | null;
  /** Applied merge ops (the edit layer), persisted per file. */
  merges: MergeOp[];
  fileName: string | null;
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
  /** The merge-confirmation modal is open. */
  mergeOpen: boolean;
  /** Chosen ancestor for the migration map (lineage = focal → this person). */
  mapAncestorId: string | null;

  loadModel: (model: GenealogyModel, fileName: string) => void;
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
  /** Fold `mergeId` into `keepId`: append an op, persist, replay, refresh. */
  mergePeople: (keepId: string, mergeId: string) => void;
  /** Undo the merge at `index` in the op-log. */
  undoMerge: (index: number) => void;
  setMapAncestor: (personId: string | null) => void;
  search: (query: string) => Person[];
  dismissWarnings: () => void;
}

const emptyInternal: InternalState = {
  model: null,
  graph: null,
  collapseSet: new Set(),
  genMap: new Map(),
  viewIds: new Set(),
};

/** Seed the visible node set from the ego network under the given view options. */
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
  // Optionally fan out to siblings of everyone in view (bounded by the budget).
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

/** Focal-dependent derived state (collapse, generations, visible ids, view). */
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

export const useStore = create<AppState>((set, get) => ({
  ...emptyInternal,
  baseModel: null,
  merges: [],
  mergeOpen: false,
  fileName: null,
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
  mapAncestorId: null,

  loadModel: (baseModel, fileName) => {
    // Replay any persisted merges over the pristine parsed model.
    const merges = loadMerges(fileName);
    const model = applyMerges(baseModel, merges);
    const graph = buildGraph(model);
    set({
      ...emptyInternal,
      baseModel,
      merges,
      model,
      graph,
      fileName,
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
    });

    if (model.persons.size === 0) {
      set({ notice: 'No individuals found in this file.' });
      return;
    }

    // Focal precedence: remembered choice → declared home person → prompt.
    const remembered = recallFocal(fileName);
    const declared = model.header?.rootPersonId;
    const chosen =
      remembered && model.persons.has(remembered)
        ? remembered
        : declared && model.persons.has(declared)
          ? declared
          : undefined;

    if (chosen) get().setFocal(chosen);
    else set({ focalPickerOpen: true });
  },

  setFocal: (personId) => {
    const { graph, model, viewOptions, fileName } = get();
    if (!graph || !model) return;
    rememberFocal(fileName, personId);
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
  },

  // Single click toggles selection (so a second click deselects); the detail
  // panel always follows the clicked person. The compare uses the ≤2 selected.
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
    const { graph, model, focalPersonId, collapseSet, genMap, viewIds, view } = get();
    if (!graph || !model || !focalPersonId || !view) return;
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
    // Make sure every person on the paths is actually visible.
    const nextIds = new Set(viewIds);
    for (const id of nodeIds) nextIds.add(id);
    set({
      viewIds: nextIds,
      view: buildView(graph, model, focalPersonId, collapseSet, genMap, nextIds),
      highlight: { fromId, toId, paths, truncated, nodeIds, edgeKeys },
    });
  },

  clearHighlight: () => set({ highlight: null }),

  // Rebuild the default view for the current focal: drops expansions, selection,
  // and highlight. Underlying data is untouched (read-only).
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

  mergePeople: (keepId, mergeId) => {
    const { baseModel, merges, fileName, focalPersonId, detailPersonId, mapAncestorId, viewOptions } =
      get();
    if (!baseModel || keepId === mergeId) return;
    const nextMerges = [...merges, { keepId, mergeId, at: new Date().toISOString() }];
    const model = applyMerges(baseModel, nextMerges);
    const graph = buildGraph(model);
    saveMerges(fileName, nextMerges);

    const focal = survivorOf(focalPersonId, nextMerges, model);
    set({
      model,
      graph,
      merges: nextMerges,
      mergeOpen: false,
      selectedIds: [],
      highlight: null,
      detailPersonId: survivorOf(detailPersonId, nextMerges, model) ?? keepId,
      mapAncestorId: survivorOf(mapAncestorId, nextMerges, model),
      notice: 'Merged. Undo it any time from the Review tab.',
      ...(focal
        ? { focalPersonId: focal, ...deriveFocalState(graph, model, focal, viewOptions) }
        : {}),
    });
  },

  undoMerge: (index) => {
    const { baseModel, merges, fileName, focalPersonId, detailPersonId, mapAncestorId, viewOptions } =
      get();
    if (!baseModel) return;
    const nextMerges = merges.filter((_, i) => i !== index);
    const model = applyMerges(baseModel, nextMerges);
    const graph = buildGraph(model);
    saveMerges(fileName, nextMerges);

    const focal = survivorOf(focalPersonId, nextMerges, model) ?? focalPersonId;
    set({
      model,
      graph,
      merges: nextMerges,
      selectedIds: [],
      highlight: null,
      detailPersonId: survivorOf(detailPersonId, nextMerges, model),
      mapAncestorId:
        mapAncestorId && model.persons.has(mapAncestorId) ? mapAncestorId : null,
      notice: 'Merge undone.',
      ...(focal && model.persons.has(focal)
        ? { focalPersonId: focal, ...deriveFocalState(graph, model, focal, viewOptions) }
        : {}),
    });
  },

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
}));
