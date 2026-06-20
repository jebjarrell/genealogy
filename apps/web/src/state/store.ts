import { create } from 'zustand';
import {
  buildGraph,
  detectPedigreeCollapse,
  enumerateRelationshipPaths,
  getEgoNetwork,
  expandPerson,
  pickDefaultFocalPerson,
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

export interface Highlight {
  fromId: string;
  toId: string;
  paths: Path[];
  truncated: boolean;
  nodeIds: Set<string>;
  edgeKeys: Set<string>;
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

  loadModel: (model: GenealogyModel, fileName: string) => void;
  setFocal: (personId: string) => void;
  selectPerson: (personId: string) => void;
  clearSelection: () => void;
  expand: (personId: string, direction: 'ancestors' | 'descendants' | 'all') => void;
  showRelationship: (fromId: string, toId: string) => void;
  clearHighlight: () => void;
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

  loadModel: (model, fileName) => {
    const graph = buildGraph(model);
    const focalPersonId = pickDefaultFocalPerson(graph, model);
    if (!focalPersonId) {
      set({
        ...emptyInternal,
        model,
        graph,
        fileName,
        warnings: model.warnings,
        focalPersonId: null,
        view: null,
        collapsePoints: [],
        notice: 'No individuals found in this file.',
      });
      return;
    }
    set({ ...emptyInternal, model, graph, fileName, warnings: model.warnings });
    get().setFocal(focalPersonId);
  },

  setFocal: (personId) => {
    const { graph, model } = get();
    if (!graph || !model) return;
    const collapsePoints = detectPedigreeCollapse(graph, personId);
    const collapseSet = new Set(collapsePoints.map((c) => c.ancestorId));
    const genMap = focalGenerations(graph, personId);
    const ego = getEgoNetwork(graph, model, personId, { nodeBudget: NODE_BUDGET });
    const viewIds = new Set(ego.nodes.map((n) => n.person.id));
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
    });
  },

  selectPerson: (personId) => {
    set((s) => {
      const selectedIds = s.selectedIds.includes(personId)
        ? s.selectedIds
        : [...s.selectedIds, personId].slice(-2);
      return { detailPersonId: personId, selectedIds };
    });
  },

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
