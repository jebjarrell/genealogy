import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGedcom } from '../src/gedcom/parse.js';
import { buildGraph } from '../src/graph/build.js';
import { SAR_RULES } from '../src/sar/rules.js';
import {
  generateChecklistStructure,
  evaluateChecklist,
  linkKey,
  serviceCitation,
  SERVICE_KEY,
  type Proof,
} from '../src/sar/checklist.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

// Pedigree-collapse fixture: focal Paul (@I11@) reaches root Alfred (@I1@) by a
// paternal 3-gen path and a maternal 4-gen path — perfect for collapse-safety.
const model = parseGedcom(fixture('pedigree-collapse.ged'));
const graph = buildGraph(model);

describe('SAR checklist structure — from an enumerated path (collapse-safe)', () => {
  const structure = generateChecklistStructure(SAR_RULES, graph, 'I11', 'I1');

  it('reaches the patriot and is not truncated', () => {
    expect(structure.reachable).toBe(true);
    expect(structure.truncated).toBe(false);
    expect(structure.societyId).toBe('sar');
  });

  it('derives the union of child→parent links without double-counting', () => {
    // Paternal: I11→I7→I3→I1.  Maternal: I11→I10→I8→I4→I1.  7 distinct links.
    const keys = structure.links.map((l) => l.key).sort();
    expect(keys).toEqual(
      [
        linkKey('I11', 'I7'),
        linkKey('I7', 'I3'),
        linkKey('I3', 'I1'),
        linkKey('I11', 'I10'),
        linkKey('I10', 'I8'),
        linkKey('I8', 'I4'),
        linkKey('I4', 'I1'),
      ].sort(),
    );
    // The patriot is the parent of two distinct links — both kept (different child).
    expect(structure.links.filter((l) => l.parentId === 'I1')).toHaveLength(2);
  });

  it('orders links by generation, nearest first', () => {
    expect(structure.links[0]!.generation).toBe(1);
    const gens = structure.links.map((l) => l.generation);
    expect([...gens]).toEqual([...gens].sort((a, b) => a - b));
  });
});

describe('SAR checklist evaluation — three-state proof', () => {
  const structure = generateChecklistStructure(SAR_RULES, graph, 'I11', 'I1');
  const firstLink = structure.links[0]!.key; // I11→I7 (gen 1)

  it('starts fully unproven (links + a separate service item)', () => {
    const e = evaluateChecklist(SAR_RULES, structure, []);
    expect(e.links.every((l) => l.status === 'unproven')).toBe(true);
    expect(e.service.status).toBe('unproven');
    expect(e.total).toBe(structure.links.length + 1);
    expect(e.proven).toBe(0);
    expect(e.completeness).toBe(0);
    expect(e.unprovenLinks).toHaveLength(structure.links.length);
  });

  it('a vault document proves a single link', () => {
    const proofs: Proof[] = [{ kind: 'document', linkKey: firstLink, docId: 'doc-1' }];
    const e = evaluateChecklist(SAR_RULES, structure, proofs);
    const link = e.links.find((l) => l.link.key === firstLink)!;
    expect(link.status).toBe('sourced-by-document');
    expect(link.docId).toBe('doc-1');
    expect(e.proven).toBe(1);
  });

  it('a post-1985 record copy spans multiple consecutive generations', () => {
    const span = [
      linkKey('I11', 'I7'),
      linkKey('I7', 'I3'),
      linkKey('I3', 'I1'),
    ];
    const proofs: Proof[] = [
      {
        kind: 'record-copy',
        coveredKeys: span,
        society: 'DAR',
        nationalNumber: '123456',
        patriotName: 'Alfred Root',
        approvedYear: 1992,
      },
    ];
    const e = evaluateChecklist(SAR_RULES, structure, proofs);
    for (const key of span) {
      const link = e.links.find((l) => l.link.key === key)!;
      expect(link.status).toBe('proven-by-record-copy');
      expect(link.recordCopy!.sufficient).toBe(true);
      expect(link.recordCopy!.nationalNumber).toBe('123456');
    }
    expect(e.proven).toBe(span.length);
  });

  it('flags a pre-1985 record copy as insufficient (stays unproven)', () => {
    const proofs: Proof[] = [
      {
        kind: 'record-copy',
        coveredKeys: [firstLink],
        society: 'SAR',
        nationalNumber: '777',
        patriotName: 'Alfred Root',
        approvedYear: 1979,
      },
    ];
    const e = evaluateChecklist(SAR_RULES, structure, proofs);
    const link = e.links.find((l) => l.link.key === firstLink)!;
    expect(link.status).toBe('unproven');
    expect(link.insufficient).toBe(true);
    expect(link.recordCopy!.sufficient).toBe(false);
    expect(e.proven).toBe(0);
  });

  it('tracks the service item separately with the correct citation form', () => {
    const proofs: Proof[] = [
      {
        kind: 'record-copy',
        coveredKeys: [SERVICE_KEY],
        society: 'SAR',
        nationalNumber: '54321',
        patriotName: 'Alfred Root',
        approvedYear: 2001,
        serviceProofCited: 'VA pension S12345',
      },
    ];
    const e = evaluateChecklist(SAR_RULES, structure, proofs);
    expect(e.service.status).toBe('proven-by-record-copy');
    expect(e.service.citation).toBe('SAR# 54321 cites VA pension S12345');
    expect(e.serviceUnproven).toBe(false);
  });

  it('serviceCitation falls back to the number when no underlying proof is cited', () => {
    expect(
      serviceCitation({
        kind: 'record-copy',
        coveredKeys: [SERVICE_KEY],
        society: 'DAR',
        nationalNumber: '9',
        patriotName: 'X',
        approvedYear: 2000,
      }),
    ).toBe('DAR# 9');
  });

  it('reports full completeness when every item is proven', () => {
    const proofs: Proof[] = [
      ...structure.links.map(
        (l): Proof => ({ kind: 'document', linkKey: l.key, docId: `doc-${l.key}` }),
      ),
      { kind: 'document', linkKey: SERVICE_KEY, docId: 'service-doc' },
    ];
    const e = evaluateChecklist(SAR_RULES, structure, proofs);
    expect(e.completeness).toBe(1);
    expect(e.unprovenLinks).toHaveLength(0);
    expect(e.proven).toBe(e.total);
  });
});

describe('SAR checklist — lineage stops at the patriot', () => {
  it('only includes links up to the chosen patriot, not beyond', () => {
    // Choose Charles (@I3@) as patriot: the line is just I11→I7→I3.
    const structure = generateChecklistStructure(SAR_RULES, graph, 'I11', 'I3');
    const keys = structure.links.map((l) => l.key).sort();
    expect(keys).toEqual([linkKey('I11', 'I7'), linkKey('I7', 'I3')].sort());
    // No link climbs above the patriot.
    expect(structure.links.some((l) => l.parentId === 'I1')).toBe(false);
  });
});
