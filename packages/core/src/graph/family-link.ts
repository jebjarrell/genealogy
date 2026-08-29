import type { GenealogyModel } from '../types/model.js';
import type { Graph } from '../types/graph.js';

// GEDCOM models parent-child THROUGH a family: a person is a CHIL of a FAM, and
// the FAM's HUSB/WIFE are the parents. There is no direct parent-child record to
// delete. So severing a link means finding the FAM that carries it, which these
// two helpers do for the edit layer (TRD 5.2).

/**
 * The id of the family through which `parentId` is a parent of `childId`, or
 * null when no such link exists. Direction matters: swapping the arguments
 * yields null unless that inverse link genuinely exists too.
 */
export function findParentChildFamily(
  graph: Graph,
  parentId: string,
  childId: string,
): string | null {
  for (const edge of graph.edges) {
    if (edge.type === 'parentOf' && edge.from === parentId && edge.to === childId) {
      return edge.familyId;
    }
  }
  return null;
}

/**
 * The other parents recorded in `familyId` besides `parentId`. Detaching a child
 * from a family removes every one of these as a parent too, so callers must be
 * able to name them before the user confirms.
 */
export function coParentsOf(
  model: GenealogyModel,
  familyId: string,
  parentId: string,
): string[] {
  const family = model.families.get(familyId);
  if (!family) return [];
  return family.spouseIds.filter((id) => id !== parentId && model.persons.has(id));
}

/**
 * The id of the family recording a marriage between `aId` and `bId`, or null
 * when they are not recorded as spouses. Spouse edges are stored once in a
 * stable order rather than in both directions, so both orders are checked.
 */
export function findSpouseFamily(
  graph: Graph,
  aId: string,
  bId: string,
): string | null {
  if (aId === bId) return null;
  for (const edge of graph.edges) {
    if (edge.type !== 'spouseOf') continue;
    if (
      (edge.from === aId && edge.to === bId) ||
      (edge.from === bId && edge.to === aId)
    ) {
      return edge.familyId;
    }
  }
  return null;
}
