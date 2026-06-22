import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGedcom } from '../src/gedcom/parse.js';
import { buildGraph } from '../src/graph/build.js';
import { computeFamilyStats } from '../src/analytics/family-stats.js';

function load(name: string) {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  const model = parseGedcom(readFileSync(fileURLToPath(url), 'utf-8'));
  return { model, graph: buildGraph(model) };
}

describe('computeFamilyStats — direct ancestors of focal', () => {
  const { model, graph } = load('minimal.ged');
  const stats = computeFamilyStats(model, graph, 'I3');

  it('counts ancestors and the deepest generation', () => {
    expect(stats.ancestorCount).toBe(2); // I1, I2
    expect(stats.maxGeneration).toBe(1);
  });

  it('computes longevity over ancestors with both years', () => {
    // Only John (1900–1975) has both; Jane has no death year.
    expect(stats.longevity).toEqual({
      count: 1,
      averageYears: 75,
      medianYears: 75,
    });
  });

  it('finds the most common birth region (state), country dropped', () => {
    expect(stats.topRegions[0]).toEqual({ region: 'New York', count: 1 });
  });

  it('averages children across ancestral couples', () => {
    expect(stats.averageFamilySize).toEqual({ couples: 1, averageChildren: 1 });
  });

  it('reports no military service when there are no military events', () => {
    expect(stats.military.servedCount).toBe(0);
    expect(stats.military.byWar).toEqual([]);
  });
});
