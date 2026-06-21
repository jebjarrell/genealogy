import { create } from 'zustand';
import {
  buildGraph,
  detectPedigreeCollapse,
  enumerateRelationshipPaths,
  getEgoNetwork,
  expandPerson,
  type CollapsePoint,
  type GenealogyModel,
  type Graph,
  type GraphView,
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
}

const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  ancestorGenerations: 4,
  descendantGenerations: 0,
  includeSpouses: false,
  showMarriageEdges: false,
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

interface InternalState {
  model: GenealogyModel | null;
  graph: Graph | null;
  collapseSet: Set<string>;
  genMap: Map<string, number>;
  viewIds: Set<string>;
}

export interface AppState extends InternalState {
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
  return new Set(ego.nodes.map((n) => n.person.id));
}

export const useStore = create<AppState>((set, get) => ({
  ...emptyInternal,
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

  loadModel: (model, fileName) => {
    const graph = buildGraph(model);
    set({
      ...emptyInternal,
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
    const collapsePoints = detectPedigreeCollapse(graph, personId);
    const collapseSet = new Set(collapsePoints.map((c) => c.ancestorId));
    const genMap = focalGenerations(graph, personId);
    const viewIds = baseViewIds(graph, model, personId, viewOptions);
    rememberFocal(fileName, personId);
    set({
      focalPersonId: personId,
      collapsePoints,
      collapseSet,
      genMap,
      viewIds,
      view: buildView(graph, model, personId, collapseSet, genMap, viewIds),
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
