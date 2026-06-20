import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGedcom } from '../src/gedcom/parse.js';
import { buildGraph } from '../src/graph/build.js';
import { pickDefaultFocalPerson } from '../src/graph/focal.js';
import { extractEventSequence } from '../src/graph/event-sequence.js';

function modelOf(name: string) {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return parseGedcom(readFileSync(fileURLToPath(url), 'utf-8'));
}

describe('pickDefaultFocalPerson', () => {
  it('pedigree-collapse.ged → the youngest leaf I11 (birth 1960)', () => {
    const model = modelOf('pedigree-collapse.ged');
    const graph = buildGraph(model);
    expect(pickDefaultFocalPerson(graph, model)).toBe('I11');
  });

  it('cousins.ged → the latest leaf I12 (birth 1931)', () => {
    const model = modelOf('cousins.ged');
    const graph = buildGraph(model);
    expect(pickDefaultFocalPerson(graph, model)).toBe('I12');
  });

  it('minimal.ged → the only childless leaf I3 (birth 1925)', () => {
    const model = modelOf('minimal.ged');
    const graph = buildGraph(model);
    expect(pickDefaultFocalPerson(graph, model)).toBe('I3');
  });
});

describe('extractEventSequence — minimal.ged', () => {
  it('returns located events in chronological order, excluding placeless ones', () => {
    const model = modelOf('minimal.ged');
    const seq = extractEventSequence(model, 'I1');

    // birth (New York) and marriage (New York) have places; the 1975 death
    // has a date but NO place, so it is excluded.
    expect(seq).toHaveLength(2);
    expect(seq[0]!.event.type).toBe('birth');
    expect(seq[0]!.place.raw).toBe('New York, New York, United States');
    expect(seq[1]!.event.type).toBe('marriage');
    expect(seq[1]!.place.raw).toBe('New York, New York, United States');

    // Chronological: 1900 birth before 1924 marriage.
    expect(seq[0]!.sortKey).toBeLessThan(seq[1]!.sortKey);
    expect(seq.every((le) => le.event.place !== undefined)).toBe(true);
  });
});
