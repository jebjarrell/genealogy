import type { Person } from './persons.js';

// The graph is derived from GenealogyModel. Ancestry is a directed acyclic
// structure (a person points to their parents); pedigree collapse appears as
// reconverging paths in that DAG (TRD §5.3).

export type EdgeType = 'parentOf' | 'spouseOf';
// childOf is the inverse of parentOf and is traversed, not stored separately.
// siblingOf is derived on demand (shared parent), not stored.

export interface GraphEdge {
  type: EdgeType;
  /** person id. parentOf: from = parent. spouseOf: stored once, stable order. */
  from: string;
  /** person id. parentOf: to = child. */
  to: string;
  /** The FAM this edge was derived from. */
  familyId: string;
}

export interface Graph {
  /** child id -> parent ids. */
  parentsOf: Map<string, string[]>;
  /** parent id -> child ids. */
  childrenOf: Map<string, string[]>;
  /** person id -> spouse ids. */
  spousesOf: Map<string, string[]>;
  /** Full edge list (stable order). */
  edges: GraphEdge[];
}

// A single relationship path between two people, as an ordered chain.
export interface PathStep {
  personId: string;
  /** How this person connects to the next step. */
  edgeToNext?: EdgeType;
}

export interface Path {
  /** Ordered; steps[0] = start, last = end. */
  steps: PathStep[];
  /** Number of edges (steps.length - 1). */
  length: number;
}

// The bounded subgraph the renderer draws.
export interface GraphViewNode {
  person: Person;
  /**
   * Relative to focal person; focal = 0, ancestors positive, descendants
   * negative.
   */
  generation?: number;
  isFocal: boolean;
  isPedigreeCollapsePoint: boolean;
  /** Drives the expand affordance. */
  hasUnexpandedNeighbors: boolean;
}

export interface GraphView {
  nodes: GraphViewNode[];
  /** Edges among the included nodes only. */
  edges: GraphEdge[];
  focalPersonId: string;
}
