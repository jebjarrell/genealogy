import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGedcom } from '../src/gedcom/parse.js';
import { buildGraph } from '../src/graph/build.js';
import { personSketch } from '../src/profile/sketch.js';

function load(name: string) {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  const model = parseGedcom(readFileSync(fileURLToPath(url), 'utf-8'));
  return { model, graph: buildGraph(model) };
}

describe('personSketch — minimal.ged', () => {
  const { model, graph } = load('minimal.ged');

  it('summarises a parent with spouse, child, and lifespan', () => {
    const s = personSketch(model, graph, 'I1')!;
    expect(s.name).toBe('John Smith');
    expect(s.sex).toBe('male');
    expect(s.birth?.year).toBe(1900);
    expect(s.birth?.place).toBe('New York, New York, United States');
    expect(s.death?.year).toBe(1975);
    expect(s.ageAtDeath).toBe(75);
    expect(s.spouses).toEqual([{ id: 'I2', name: 'Jane Doe' }]);
    expect(s.childrenCount).toBe(1);
    expect(s.military.served).toBe(false);
  });

  it('handles a person with no death, spouse, or children', () => {
    const s = personSketch(model, graph, 'I3')!;
    expect(s.birth?.year).toBe(1925);
    expect(s.death).toBeUndefined();
    expect(s.ageAtDeath).toBeUndefined();
    expect(s.spouses).toEqual([]);
    expect(s.childrenCount).toBe(0);
  });

  it('returns null for an unknown id', () => {
    expect(personSketch(model, graph, 'NOPE')).toBeNull();
  });
});
