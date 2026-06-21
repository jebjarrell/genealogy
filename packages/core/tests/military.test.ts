import { describe, it, expect } from 'vitest';
import { parseGedcom } from '../src/gedcom/parse.js';
import { classifyWar, militaryServiceOf, WAR_ERAS } from '../src/military/wars.js';

describe('classifyWar', () => {
  it('maps a year to the war whose window contains it', () => {
    expect(classifyWar(1776)?.id).toBe('revolution');
    expect(classifyWar(1863)?.id).toBe('civil');
    expect(classifyWar(1944)?.id).toBe('wwii');
  });

  it('is inclusive on the boundary years', () => {
    expect(classifyWar(1775)?.id).toBe('revolution');
    expect(classifyWar(1783)?.id).toBe('revolution');
  });

  it('returns null for peacetime years and unknown dates', () => {
    expect(classifyWar(1790)).toBeNull();
    expect(classifyWar(undefined)).toBeNull();
  });

  it('exposes the war eras in chronological order', () => {
    const froms = WAR_ERAS.map((w) => w.from);
    expect([...froms].sort((a, b) => a - b)).toEqual(froms);
  });
});

const MILITARY_GED = `0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Sol /Dier/
1 SEX M
1 MILI
2 DATE 1863
2 PLAC Virginia, United States
0 @I2@ INDI
1 NAME Polly /Civilian/
1 SEX F
0 TRLR
`;

describe('militaryServiceOf', () => {
  const model = parseGedcom(MILITARY_GED);

  it('detects an explicit military event and classifies its war', () => {
    const s = militaryServiceOf(model, 'I1');
    expect(s.served).toBe(true);
    expect(s.events).toHaveLength(1);
    expect(s.wars.map((w) => w.id)).toEqual(['civil']);
  });

  it('reports no service for a person without military events', () => {
    const s = militaryServiceOf(model, 'I2');
    expect(s.served).toBe(false);
    expect(s.wars).toEqual([]);
  });
});
