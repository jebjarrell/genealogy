import { describe, it, expect } from 'vitest';
import { parseGedcom, buildGraph } from '@genealogy/core';
import minimalGed from '../../../../packages/core/tests/fixtures/minimal.ged?raw';
import { lineagePaths, lineageStops, uniquePlaces } from './lineage.js';

const model = parseGedcom(minimalGed);
const graph = buildGraph(model);

describe('lineage (migration-map data)', () => {
  it('finds the ancestral path from focal up to the chosen ancestor', () => {
    const paths = lineagePaths(graph, 'I3', 'I1');
    expect(paths).toHaveLength(1);
    expect(paths[0]!.steps.map((s) => s.personId)).toEqual(['I3', 'I1']);
  });

  it('returns located events along the line, ordered chronologically', () => {
    const stops = lineageStops(model, graph, 'I3', 'I1');
    // I1 birth (NYC 1900), I1 marriage (NYC 1924), I3 birth (Boston 1925).
    expect(stops.map((s) => s.year)).toEqual([1900, 1924, 1925]);
    expect(stops.map((s) => s.place.parts?.[0])).toEqual([
      'New York',
      'New York',
      'Boston',
    ]);
  });

  it('dedupes places for geocoding (NYC appears twice → one lookup)', () => {
    const stops = lineageStops(model, graph, 'I3', 'I1');
    const places = uniquePlaces(stops);
    expect(places).toHaveLength(2);
    expect(places.map((p) => p.normalized).sort()).toEqual([
      'boston, massachusetts, united states',
      'new york, new york, united states',
    ]);
  });

  it('returns nothing when there is no consanguineous path (spouses)', () => {
    // I1 and I2 are spouses — no blood path (spouse edges are not traversed).
    expect(lineageStops(model, graph, 'I1', 'I2')).toEqual([]);
  });
});
