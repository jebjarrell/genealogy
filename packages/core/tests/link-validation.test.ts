import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGedcom } from '../src/gedcom/parse.js';
import { buildGraph } from '../src/graph/build.js';
import { checkParentChildLink, checkSpouseLink } from '../src/edit/link-validation.js';

function model(name: string) {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return parseGedcom(readFileSync(fileURLToPath(url), 'utf-8'));
}

// multiple-marriages.ged, with the years that make the date rules testable:
//   I1 Henry      b.1820   spouse in F1 and F2
//   I2 Catherine  b.1822 d.1850   spouse in F1
//   I3 Anne       b.1830   spouse in F2
//   I4 Mary       b.1845   child of F1
//   I5 Edward     b.1848   child of F1
//   I6 Elizabeth  b.1855   child of F2
const m = model('multiple-marriages.ged');
const g = buildGraph(m);

const blocks = (issues: { severity: string }[]) =>
  issues.filter((i) => i.severity === 'block');
const warns = (issues: { severity: string }[]) =>
  issues.filter((i) => i.severity === 'warn');

describe('checkParentChildLink — blocking', () => {
  it('blocks making someone their own parent', () => {
    const issues = checkParentChildLink(m, g, 'I1', 'I1');
    expect(blocks(issues)).toHaveLength(1);
    expect(blocks(issues)[0]!.message).toMatch(/their own parent/i);
  });

  it('blocks a direct cycle: making a child the parent of their own parent', () => {
    // Mary is Henry's daughter, so Henry cannot also be Mary's child.
    const issues = checkParentChildLink(m, g, 'I4', 'I1');
    expect(blocks(issues)).toHaveLength(1);
    expect(blocks(issues)[0]!.message).toMatch(/own ancestor/i);
  });

  it('blocks an indirect cycle across generations', () => {
    const THREE_GENERATIONS = `0 HEAD
0 @I1@ INDI
1 NAME Grand /Parent/
0 @I2@ INDI
1 NAME Middle /Parent/
1 FAMC @F1@
0 @I3@ INDI
1 NAME Grand /Child/
1 FAMC @F2@
0 @F1@ FAM
1 HUSB @I1@
1 CHIL @I2@
0 @F2@ FAM
1 HUSB @I2@
1 CHIL @I3@
0 TRLR
`;
    const three = parseGedcom(THREE_GENERATIONS);
    const issues = checkParentChildLink(three, buildGraph(three), 'I3', 'I1');
    expect(blocks(issues)).toHaveLength(1);
    expect(blocks(issues)[0]!.message).toMatch(/own ancestor/i);
  });

  it('allows a legitimate link that merely reconverges (pedigree collapse)', () => {
    // Linking Anne as a second parent of Mary is odd but not circular.
    expect(blocks(checkParentChildLink(m, g, 'I3', 'I4'))).toEqual([]);
  });
});

describe('checkParentChildLink — warnings', () => {
  it('warns when the parent was born after the child', () => {
    // Elizabeth b.1855 cannot be the parent of Mary b.1845.
    const issues = warns(checkParentChildLink(m, g, 'I6', 'I4'));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/born .* after/i);
  });

  it('warns when the parent was implausibly young, without double-reporting', () => {
    // Mary b.1845 would have been 10 at Elizabeth's birth in 1855.
    const issues = warns(checkParentChildLink(m, g, 'I4', 'I6'));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/would have been 10/i);
  });

  it('warns when the child was born well after the parent died', () => {
    // Catherine d.1850; Elizabeth b.1855.
    const issues = warns(checkParentChildLink(m, g, 'I2', 'I6'));
    expect(issues.some((i) => /after .* died/i.test(i.message))).toBe(true);
  });

  it('warns when the link already exists', () => {
    const issues = warns(checkParentChildLink(m, g, 'I1', 'I4'));
    expect(issues.some((i) => /already/i.test(i.message))).toBe(true);
  });

  it('raises nothing on a plausible link', () => {
    // Anne b.1830 as a parent of Edward b.1848: she was 18, no existing link.
    expect(checkParentChildLink(m, g, 'I3', 'I5')).toEqual([]);
  });

  it('raises no date issue when a date is unknown', () => {
    const NO_DATES = `0 HEAD
0 @I1@ INDI
1 NAME No /Dates/
0 @I2@ INDI
1 NAME Also /Undated/
0 TRLR
`;
    const undated = parseGedcom(NO_DATES);
    expect(checkParentChildLink(undated, buildGraph(undated), 'I1', 'I2')).toEqual([]);
  });

  it('raises nothing for people who are not in the model', () => {
    expect(checkParentChildLink(m, g, 'NOPE', 'I4')).toEqual([]);
  });
});

describe('checkSpouseLink', () => {
  it('blocks marrying someone to themself', () => {
    const issues = checkSpouseLink(m, g, 'I1', 'I1');
    expect(blocks(issues)).toHaveLength(1);
    expect(blocks(issues)[0]!.message).toMatch(/themselves/i);
  });

  it('warns when the two are already recorded as spouses', () => {
    const issues = warns(checkSpouseLink(m, g, 'I1', 'I2'));
    expect(issues.some((i) => /already/i.test(i.message))).toBe(true);
  });

  it('warns, but does not block, marrying a direct descendant', () => {
    // Spouse edges are not part of the ancestry DAG, so this cannot create a
    // cycle. It is implausible rather than impossible, and erroneous imports do
    // contain it - so inform and let the user decide.
    const issues = checkSpouseLink(m, g, 'I1', 'I4');
    expect(blocks(issues)).toEqual([]);
    expect(warns(issues).some((i) => /parent and child/i.test(i.message))).toBe(true);
  });

  it('raises nothing for an unrelated pair', () => {
    expect(checkSpouseLink(m, g, 'I3', 'I5')).toEqual([]);
  });
});
