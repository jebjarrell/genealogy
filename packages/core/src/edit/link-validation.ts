import type { GenealogyModel } from '../types/model.js';
import type { Graph } from '../types/graph.js';
import { getDescendants } from '../graph/traversal.js';
import { eventYear } from '../model/person-events.js';

// Linking an EXISTING person makes impossible relationships reachable in a way
// that attaching a freshly created person never was. Two severities:
//
//   block - never valid, and silently corrupts derived views. A cycle in the
//           ancestry DAG breaks generation numbering and pedigree-collapse
//           detection with nothing pointing back at the edit that caused it.
//   warn  - usually wrong, sometimes genuinely recorded that way. Source dates
//           are frequently estimates, so dates inform rather than refuse.
//
// Every date rule compares only when BOTH years are known. A missing or
// unparseable date is never evidence of a problem (TRD 7.2).

/** Youngest plausible age at which someone becomes a parent. */
const MIN_PARENT_AGE = 13;
/** Grace period after a parent's death, for a posthumous birth. */
const POSTHUMOUS_GRACE_YEARS = 1;

export type LinkSeverity = 'block' | 'warn';

export interface LinkIssue {
  severity: LinkSeverity;
  message: string;
}

function nameOf(model: GenealogyModel, id: string): string {
  return model.persons.get(id)?.names[0]?.full ?? id;
}

/** True when `ancestorId` already sits above `descendantId` in the ancestry DAG. */
function isDescendantOf(
  graph: Graph,
  ancestorId: string,
  descendantId: string,
): boolean {
  return getDescendants(graph, ancestorId).includes(descendantId);
}

/**
 * Issues raised by making `parentId` a parent of `childId`. An empty array means
 * the link is unremarkable.
 */
export function checkParentChildLink(
  model: GenealogyModel,
  graph: Graph,
  parentId: string,
  childId: string,
): LinkIssue[] {
  const issues: LinkIssue[] = [];
  if (!model.persons.has(parentId) || !model.persons.has(childId)) return issues;

  const parent = nameOf(model, parentId);
  const child = nameOf(model, childId);

  if (parentId === childId) {
    return [{ severity: 'block', message: `${parent} cannot be their own parent.` }];
  }

  // The proposed parent is already below the child in the tree, so the link
  // would close a loop.
  if (isDescendantOf(graph, childId, parentId)) {
    return [
      {
        severity: 'block',
        message: `${parent} is already a descendant of ${child}, so this would make ${child} their own ancestor.`,
      },
    ];
  }

  const existingParents = graph.parentsOf.get(childId) ?? [];
  if (existingParents.includes(parentId)) {
    issues.push({
      severity: 'warn',
      message: `${parent} is already recorded as a parent of ${child}.`,
    });
  } else if (existingParents.length > 0) {
    // Person.familyIdAsChild is singular, so applyLink repoints it at the new
    // family. Every parent still renders in the UI, but a GEDCOM export will
    // name only this family as the child's parentage - a silent loss unless
    // it is said here.
    issues.push({
      severity: 'warn',
      message: `${child} already has recorded parents (${existingParents
        .map((id) => nameOf(model, id))
        .join(' and ')}). This family will be the one exported as their parentage.`,
    });
  }

  const parentBirth = eventYear(model, parentId, 'birth');
  const childBirth = eventYear(model, childId, 'birth');
  const parentDeath = eventYear(model, parentId, 'death');

  if (parentBirth !== undefined && childBirth !== undefined) {
    if (parentBirth > childBirth) {
      // Subsumes the young-parent rule; reporting both would be noise.
      issues.push({
        severity: 'warn',
        message: `${parent} was born in ${parentBirth}, after ${child} in ${childBirth}.`,
      });
    } else if (childBirth - parentBirth < MIN_PARENT_AGE) {
      issues.push({
        severity: 'warn',
        message: `${parent} would have been ${childBirth - parentBirth} at ${child}'s birth.`,
      });
    }
  }

  if (
    parentDeath !== undefined &&
    childBirth !== undefined &&
    childBirth > parentDeath + POSTHUMOUS_GRACE_YEARS
  ) {
    issues.push({
      severity: 'warn',
      message: `${child} was born in ${childBirth}, after ${parent} died in ${parentDeath}.`,
    });
  }

  return issues;
}

/**
 * Issues raised by recording `aId` and `bId` as spouses. Spouse edges are not
 * part of the ancestry DAG, so no spouse link can create a cycle - the only
 * blocking case is marrying someone to themselves.
 */
export function checkSpouseLink(
  model: GenealogyModel,
  graph: Graph,
  aId: string,
  bId: string,
): LinkIssue[] {
  const issues: LinkIssue[] = [];
  if (!model.persons.has(aId) || !model.persons.has(bId)) return issues;

  const a = nameOf(model, aId);
  const b = nameOf(model, bId);

  if (aId === bId) {
    return [{ severity: 'block', message: `${a} cannot be married to themselves.` }];
  }

  if ((graph.spousesOf.get(aId) ?? []).includes(bId)) {
    issues.push({
      severity: 'warn',
      message: `${a} and ${b} are already recorded as spouses.`,
    });
  }

  if (
    (graph.parentsOf.get(bId) ?? []).includes(aId) ||
    (graph.parentsOf.get(aId) ?? []).includes(bId)
  ) {
    issues.push({
      severity: 'warn',
      message: `${a} and ${b} are already recorded as parent and child.`,
    });
  }

  return issues;
}
