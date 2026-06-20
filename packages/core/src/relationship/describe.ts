import type { Graph } from '../types/graph.js';
import type { GenealogyModel, Sex } from '../types/index.js';
import { getAncestors, getDescendants } from '../graph/traversal.js';
import { computeGenerations } from '../graph/generations.js';
import { findCommonAncestors } from '../graph/common-ancestors.js';
import { greatPrefix, ordinalWord, removalWord } from './ordinals.js';

// Human-readable relationship description (TRD §9). Pure: derives terms purely
// from generation distances and the typed graph; no DOM / Node / network.

function bySex(sex: Sex, male: string, female: string, neutral: string): string {
  if (sex === 'male') return male;
  if (sex === 'female') return female;
  return neutral;
}

/**
 * Term for an ancestor `g` generations up (g >= 1), by the ANCESTOR's sex.
 * g=1 parent, g=2 grandparent, g>=3 great-…-grandparent.
 */
export function describeAncestorByGenerations(g: number, sex: Sex): string {
  const root = bySex(sex, 'father', 'mother', 'parent');
  if (g <= 1) return root;
  if (g === 2) return `grand${root}`;
  return `${greatPrefix(g - 2)}grand${root}`;
}

/**
 * Term for a descendant `g` generations down (g >= 1), by the DESCENDANT's sex.
 * g=1 child, g=2 grandchild, g>=3 great-…-grandchild.
 */
export function describeDescendantByGenerations(g: number, sex: Sex): string {
  const root = bySex(sex, 'son', 'daughter', 'child');
  if (g <= 1) return root;
  if (g === 2) return `grand${root}`;
  return `${greatPrefix(g - 2)}grand${root}`;
}

/** Human-readable relationship of `toId` relative to `fromId` (TRD §9). */
export function describeRelationship(
  graph: Graph,
  model: GenealogyModel,
  fromId: string,
  toId: string,
): string {
  if (fromId === toId) return 'self';

  const sexOf = (id: string): Sex => model.persons.get(id)?.sex ?? 'unknown';

  // 1. toId is an ancestor of fromId → parent / grandparent / great-…
  if (getAncestors(graph, fromId).includes(toId)) {
    const g = computeGenerations(graph, fromId).get(toId) ?? 1;
    return describeAncestorByGenerations(g, sexOf(toId));
  }

  // 2. toId is a descendant of fromId → child / grandchild / great-…
  if (getDescendants(graph, fromId).includes(toId)) {
    // Distance from toId UP to fromId is the descendant depth.
    const g = computeGenerations(graph, toId).get(fromId) ?? 1;
    return describeDescendantByGenerations(g, sexOf(toId));
  }

  // 3. Collateral: meet at a nearest common ancestor.
  const commons = findCommonAncestors(graph, fromId, toId);
  const nearest = commons[0];
  if (nearest === undefined) {
    return 'no traceable relationship within this tree';
  }
  const a = nearest.generationsFromA; // fromId → ancestor
  const b = nearest.generationsFromB; // toId → ancestor

  // Siblings.
  if (a === 1 && b === 1) {
    return bySex(sexOf(toId), 'brother', 'sister', 'sibling');
  }

  // Aunt/uncle (toId closer to ancestor) or niece/nephew (toId further).
  if (Math.min(a, b) === 1 && Math.max(a, b) >= 2) {
    if (b < a) {
      const base = bySex(sexOf(toId), 'uncle', 'aunt', 'aunt or uncle');
      return `${greatPrefix(a - 2)}${base}`;
    }
    const base = bySex(sexOf(toId), 'nephew', 'niece', 'niece or nephew');
    return `${greatPrefix(b - 2)}${base}`;
  }

  // Cousins.
  const degree = Math.min(a, b) - 1;
  const removal = Math.abs(a - b);
  const base = `${ordinalWord(degree)} cousin`;
  if (removal === 0) return base;
  return `${base} ${removalWord(removal)} removed`;
}
