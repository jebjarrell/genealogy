import type { GenealogyModel } from '../types/model.js';

// Linking an existing person needs a family to link them INTO, because GEDCOM
// has no direct person-to-person relationship record. Usually there is exactly
// one sensible family and the caller should just use it; sometimes - a
// remarriage - there are several and only the user can say which. These two
// functions answer "which families could this link join?" and leave the choice
// to the caller. An empty result means "no existing family fits; make one".

export interface FamilyCandidate {
  familyId: string;
  spouseIds: string[];
  childIds: string[];
}

function candidate(
  familyId: string,
  spouseIds: string[],
  childIds: string[],
): FamilyCandidate {
  return { familyId, spouseIds: [...spouseIds], childIds: [...childIds] };
}

/**
 * Families a new CHILD of `parentId` could join: the ones where that person is
 * already recorded as a spouse. Several means a remarriage, and the caller must
 * ask rather than guess.
 */
export function candidateFamiliesForChild(
  model: GenealogyModel,
  parentId: string,
): FamilyCandidate[] {
  const out: FamilyCandidate[] = [];
  for (const family of model.families.values()) {
    if (family.spouseIds.includes(parentId)) {
      out.push(candidate(family.id, family.spouseIds, family.childIds));
    }
  }
  return out;
}

/**
 * Families a new PARENT of `childId` could join: the ones where that person is
 * already recorded as a child.
 *
 * Derived from the family records rather than `Person.familyIdAsChild`, which is
 * singular - a child listed under two couples has a pointer to only one of them,
 * and the other would otherwise be unreachable.
 */
export function candidateFamiliesForParent(
  model: GenealogyModel,
  childId: string,
): FamilyCandidate[] {
  const out: FamilyCandidate[] = [];
  for (const family of model.families.values()) {
    if (family.childIds.includes(childId)) {
      out.push(candidate(family.id, family.spouseIds, family.childIds));
    }
  }
  return out;
}

/**
 * Families a new SPOUSE of `personId` could join.
 *
 * Deliberately narrower than the other two: a family that already records two
 * spouses is a completed marriage, and adding a third person to it would both
 * invent a polygamous couple and silently record the newcomer as a parent of
 * that marriage's children. A remarriage belongs in a new family instead.
 *
 * The one case worth joining is a family holding a single parent and their
 * children - the missing spouse genuinely belongs there, and joining is what
 * makes them a parent of those children.
 */
export function candidateFamiliesForSpouse(
  model: GenealogyModel,
  personId: string,
): FamilyCandidate[] {
  return candidateFamiliesForChild(model, personId).filter(
    (c) => c.spouseIds.length < 2,
  );
}
