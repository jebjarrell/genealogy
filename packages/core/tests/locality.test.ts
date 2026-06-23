import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGedcom } from '../src/gedcom/parse.js';
import { buildGraph } from '../src/graph/build.js';
import {
  buildLocalityReport,
  localityReportToMarkdown,
} from '../src/research/locality.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const model = parseGedcom(fixture('pedigree-collapse.ged'));
const graph = buildGraph(model);

describe('locality report — collapse-safe people set', () => {
  const report = buildLocalityReport(model, graph, 'I11', 'I1');

  it('dedupes ancestors reached by multiple paths (no double count)', () => {
    // Union of both paths: I11,I7,I3,I1,I10,I8,I4 — the shared root I1 appears once.
    expect([...report.personIds].sort()).toEqual(
      ['I1', 'I10', 'I11', 'I3', 'I4', 'I7', 'I8'].sort(),
    );
    const count = report.personIds.filter((id) => id === 'I1').length;
    expect(count).toBe(1);
  });
});

describe('locality report — pivot, citation status, research targets', () => {
  // A small line: a focal child with a placed+sourced birth, an unsourced
  // residence, and a parent with nothing recorded.
  const ged = `0 HEAD
1 CHAR UTF-8
0 @C@ INDI
1 NAME Kid /Doe/
1 FAMC @F@
1 BIRT
2 DATE 1850
2 PLAC Louisville, Jefferson, Kentucky
2 SOUR Birth certificate
1 RESI
2 DATE 1860
2 PLAC Boone County, West Virginia
0 @P@ INDI
1 NAME Pa /Doe/
1 SEX M
1 FAMS @F@
0 @F@ FAM
1 HUSB @P@
1 CHIL @C@
0 TRLR
`;
  const m = parseGedcom(ged);
  const g = buildGraph(m);
  const report = buildLocalityReport(m, g, 'C', 'P');

  it('pivots facts into place rows sorted with the unknown bucket last', () => {
    const labels = report.rows.map((r) => r.placeLabel);
    expect(labels[labels.length - 1]).toBe('(no record)');
    expect(labels).toContain('Louisville, Jefferson, Kentucky');
    expect(labels).toContain('Boone County, West Virginia');
  });

  it('marks a sourced fact sourced and an unsourced fact a research target', () => {
    const louisville = report.rows.find((r) => r.placeKey.includes('louisville'))!;
    expect(louisville.facts[0]!.status).toBe('sourced');
    expect(louisville.isResearchTarget).toBe(false);

    const boone = report.rows.find((r) => r.placeKey.includes('boone'))!;
    expect(boone.facts[0]!.status).toBe('unsourced');
    expect(boone.isResearchTarget).toBe(true);
  });

  it('surfaces missing vital records as `none` cells', () => {
    const unknown = report.rows.find((r) => r.placeKey === '')!;
    expect(unknown.facts.every((f) => f.status === 'none')).toBe(true);
    // The parent has no birth/death recorded at all → those are research targets.
    const paGaps = unknown.facts.filter((f) => f.personId === 'P').map((f) => f.eventType);
    expect(paGaps).toEqual(expect.arrayContaining(['birth', 'death']));
    expect(report.gapCount).toBeGreaterThan(0);
  });

  it('renders an exportable Markdown plan', () => {
    const md = localityReportToMarkdown(report, 'Kid Doe → Pa Doe');
    expect(md).toContain('# Locality research report');
    expect(md).toContain('research target');
  });
});
