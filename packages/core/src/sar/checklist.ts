import type { Graph } from '../types/graph.js';
import { enumerateAncestralPaths } from '../graph/paths.js';
import type { EnumeratePathsOptions } from '../graph/paths.js';
import type { ProofStatus, SocietyRules } from './rules.js';

// SAR proof checklist (handoff §5b). Given a patriot ancestor the user has
// chosen, derive the chain of child→parent links from the applicant (focal) up
// to the patriot — from an ENUMERATED PATH so braided / pedigree-collapsed lines
// are handled correctly and no generational link is represented twice — plus the
// patriot's separate service item. The proof state of each item is then computed
// from the user's recorded proofs (vault documents and record-copy tie-ins),
// enforcing the post-1985 record-copy cutoff and multi-generation spans.
//
// Pure: no I/O, no society-specific hard-coding (everything reads `SocietyRules`).

/** The fixed key for the patriot's qualifying-service checklist item. */
export const SERVICE_KEY = 'service';

/** One child→parent generational link to prove. */
export interface LineageLink {
  /** Stable key `${childId}->${parentId}`. */
  key: string;
  childId: string;
  parentId: string;
  /** Distance from the applicant (1 = applicant→parent). */
  generation: number;
}

/** The structural checklist derived purely from the tree (no proof state yet). */
export interface ChecklistStructure {
  societyId: string;
  focalId: string;
  patriotId: string;
  /** Ordered nearest→patriot, deduplicated across braided paths. */
  links: LineageLink[];
  /** True when the patriot is reachable as an ancestor of the focal person. */
  reachable: boolean;
  /** True when path enumeration hit a cap (deep, densely intermarried tree). */
  truncated: boolean;
}

/** Proof by a vault document. `linkKey` may be a link key or {@link SERVICE_KEY}. */
export interface DocumentProof {
  kind: 'document';
  linkKey: string;
  docId: string;
}

/**
 * Proof by a previously-approved SAR/DAR application ("record copy"). May cover a
 * contiguous SPAN of consecutive links (and/or the service item). Only carries
 * the national number + patriot name as the tie-in (DAR ancestor / SAR "P"
 * numbers carry no usable data and are deliberately not stored).
 */
export interface RecordCopyProof {
  kind: 'record-copy';
  /** Link keys covered (and/or {@link SERVICE_KEY}). */
  coveredKeys: string[];
  society: 'SAR' | 'DAR';
  nationalNumber: string;
  patriotName: string;
  /** Year the cited application was approved (drives the 1985 cutoff). */
  approvedYear: number;
  /** When the record copy carries the service proof: the underlying proof cited. */
  serviceProofCited?: string;
}

export type Proof = DocumentProof | RecordCopyProof;

export interface RecordCopyRef {
  society: 'SAR' | 'DAR';
  nationalNumber: string;
  patriotName: string;
  approvedYear: number;
  /** True when approved on/after the cutoff (full proof); false = insufficient alone. */
  sufficient: boolean;
}

export interface LinkEvaluation {
  link: LineageLink;
  status: ProofStatus;
  docId?: string;
  recordCopy?: RecordCopyRef;
  /** True when the only backing is a pre-cutoff record copy (not sufficient alone). */
  insufficient?: boolean;
}

export interface ServiceEvaluation {
  status: ProofStatus;
  docId?: string;
  recordCopy?: RecordCopyRef;
  /** Citation form for a record-copy-backed service item. */
  citation?: string;
  insufficient?: boolean;
}

export interface ChecklistEvaluation {
  links: LinkEvaluation[];
  service: ServiceEvaluation;
  /** Links (in order) that are still {@link ProofStatus} `unproven`. */
  unprovenLinks: LineageLink[];
  /** Total items = lineage links + the service item. */
  total: number;
  /** Items proven by document or sufficient record copy. */
  proven: number;
  /** proven / total, 0..1 (1 when there are no items). */
  completeness: number;
  serviceUnproven: boolean;
}

/** Build a stable link key. */
export function linkKey(childId: string, parentId: string): string {
  return `${childId}->${parentId}`;
}

/**
 * Derive the lineage links + reachability for a chosen patriot, from the
 * enumerated relationship paths between the focal person and the patriot. Links
 * are deduplicated (a link reached by several braided routes appears once) and
 * ordered by generation. Lineage stops at the patriot (handoff §5a).
 */
export function generateChecklistStructure(
  rules: SocietyRules,
  graph: Graph,
  focalId: string,
  patriotId: string,
  options?: EnumeratePathsOptions,
): ChecklistStructure {
  const { paths, truncated } = enumerateAncestralPaths(
    graph,
    focalId,
    patriotId,
    options,
  );

  const byKey = new Map<string, LineageLink>();
  for (const path of paths) {
    for (let i = 0; i < path.steps.length - 1; i++) {
      const childId = path.steps[i]!.personId;
      const parentId = path.steps[i + 1]!.personId;
      const key = linkKey(childId, parentId);
      const generation = i + 1;
      const existing = byKey.get(key);
      if (existing === undefined) {
        byKey.set(key, { key, childId, parentId, generation });
      } else if (generation < existing.generation) {
        existing.generation = generation;
      }
    }
  }

  const links = [...byKey.values()].sort(
    (a, b) => a.generation - b.generation || a.key.localeCompare(b.key),
  );

  return {
    societyId: rules.id,
    focalId,
    patriotId,
    links,
    reachable: paths.length > 0,
    truncated,
  };
}

function refFrom(rules: SocietyRules, rc: RecordCopyProof): RecordCopyRef {
  return {
    society: rc.society,
    nationalNumber: rc.nationalNumber,
    patriotName: rc.patriotName,
    approvedYear: rc.approvedYear,
    sufficient: rc.approvedYear >= rules.recordCopyCutoffYear,
  };
}

/** Citation form for a record-copy service tie-in: `SAR# 12345 cites <proof>`. */
export function serviceCitation(rc: RecordCopyProof): string {
  const head = `${rc.society}# ${rc.nationalNumber}`;
  return rc.serviceProofCited ? `${head} cites ${rc.serviceProofCited}` : head;
}

/** Evaluate one item (link key or service) against the recorded proofs. */
function evaluateKey(
  rules: SocietyRules,
  key: string,
  proofs: Proof[],
): {
  status: ProofStatus;
  docId?: string;
  recordCopy?: RecordCopyRef;
  insufficient?: boolean;
  citation?: string;
} {
  // A document is the strongest, simplest proof.
  for (const p of proofs) {
    if (p.kind === 'document' && p.linkKey === key) {
      return { status: 'sourced-by-document', docId: p.docId };
    }
  }

  // Otherwise look for a record copy covering this key. A sufficient (post-cutoff)
  // one proves it; a pre-cutoff one is recorded but leaves the item unproven.
  let pending: { rc: RecordCopyProof; ref: RecordCopyRef } | undefined;
  for (const p of proofs) {
    if (p.kind !== 'record-copy' || !p.coveredKeys.includes(key)) continue;
    const ref = refFrom(rules, p);
    if (ref.sufficient) {
      const out: ReturnType<typeof evaluateKey> = {
        status: 'proven-by-record-copy',
        recordCopy: ref,
      };
      if (key === SERVICE_KEY) out.citation = serviceCitation(p);
      return out;
    }
    if (pending === undefined) pending = { rc: p, ref };
  }

  if (pending !== undefined) {
    const out: ReturnType<typeof evaluateKey> = {
      status: 'unproven',
      recordCopy: pending.ref,
      insufficient: true,
    };
    if (key === SERVICE_KEY) out.citation = serviceCitation(pending.rc);
    return out;
  }

  return { status: 'unproven' };
}

/**
 * Evaluate the full checklist: per-link and service proof status, the remaining
 * unproven links, and overall completeness. Enforces the record-copy cutoff and
 * honors multi-generation record-copy spans (one record copy can prove several
 * consecutive links). The required-proof list therefore "tops out" at the
 * earliest link not covered by a sufficient record copy — exactly the items
 * returned in {@link ChecklistEvaluation.unprovenLinks}.
 */
export function evaluateChecklist(
  rules: SocietyRules,
  structure: ChecklistStructure,
  proofs: Proof[],
): ChecklistEvaluation {
  const links: LinkEvaluation[] = structure.links.map((link) => {
    const r = evaluateKey(rules, link.key, proofs);
    const out: LinkEvaluation = { link, status: r.status };
    if (r.docId !== undefined) out.docId = r.docId;
    if (r.recordCopy !== undefined) out.recordCopy = r.recordCopy;
    if (r.insufficient) out.insufficient = true;
    return out;
  });

  const sr = evaluateKey(rules, SERVICE_KEY, proofs);
  const service: ServiceEvaluation = { status: sr.status };
  if (sr.docId !== undefined) service.docId = sr.docId;
  if (sr.recordCopy !== undefined) service.recordCopy = sr.recordCopy;
  if (sr.citation !== undefined) service.citation = sr.citation;
  if (sr.insufficient) service.insufficient = true;

  const unprovenLinks = links.filter((l) => l.status === 'unproven').map((l) => l.link);
  const total = links.length + 1; // + service
  const provenLinks = links.filter((l) => l.status !== 'unproven').length;
  const proven = provenLinks + (service.status !== 'unproven' ? 1 : 0);

  return {
    links,
    service,
    unprovenLinks,
    total,
    proven,
    completeness: total === 0 ? 1 : proven / total,
    serviceUnproven: service.status === 'unproven',
  };
}
