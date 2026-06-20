import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGedcom } from '../src/gedcom/parse.js';
import { buildGraph } from '../src/graph/build.js';
import {
  describeRelationship,
  describeAncestorByGenerations,
  describeDescendantByGenerations,
} from '../src/relationship/describe.js';
import {
  ordinal,
  ordinalWord,
  removalWord,
  greatPrefix,
} from '../src/relationship/ordinals.js';

function load(name: string): string {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf-8');
}

function buildFrom(name: string) {
  const model = parseGedcom(load(name));
  const graph = buildGraph(model);
  return { model, graph };
}

describe('ordinals', () => {
  it('ordinal()', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(23)).toBe('23rd');
  });

  it('ordinalWord()', () => {
    expect(ordinalWord(1)).toBe('first');
    expect(ordinalWord(2)).toBe('second');
    expect(ordinalWord(3)).toBe('third');
    expect(ordinalWord(4)).toBe('fourth');
    expect(ordinalWord(20)).toBe('twentieth');
    // Beyond the word table falls back to ordinal().
    expect(ordinalWord(21)).toBe(ordinal(21));
  });

  it('removalWord()', () => {
    expect(removalWord(1)).toBe('once');
    expect(removalWord(2)).toBe('twice');
    expect(removalWord(3)).toBe('three times');
    expect(removalWord(4)).toBe('four times');
  });

  it('greatPrefix()', () => {
    expect(greatPrefix(0)).toBe('');
    expect(greatPrefix(1)).toBe('great-');
    expect(greatPrefix(2)).toBe('2nd great-');
    expect(greatPrefix(3)).toBe('3rd great-');
  });
});

describe('describeAncestorByGenerations', () => {
  it('g=1', () => {
    expect(describeAncestorByGenerations(1, 'male')).toBe('father');
    expect(describeAncestorByGenerations(1, 'female')).toBe('mother');
    expect(describeAncestorByGenerations(1, 'unknown')).toBe('parent');
  });
  it('g=2', () => {
    expect(describeAncestorByGenerations(2, 'male')).toBe('grandfather');
    expect(describeAncestorByGenerations(2, 'female')).toBe('grandmother');
    expect(describeAncestorByGenerations(2, 'unknown')).toBe('grandparent');
  });
  it('g>=3', () => {
    expect(describeAncestorByGenerations(3, 'male')).toBe('great-grandfather');
    expect(describeAncestorByGenerations(4, 'female')).toBe('2nd great-grandmother');
    expect(describeAncestorByGenerations(5, 'unknown')).toBe('3rd great-grandparent');
  });
});

describe('describeDescendantByGenerations', () => {
  it('g=1', () => {
    expect(describeDescendantByGenerations(1, 'male')).toBe('son');
    expect(describeDescendantByGenerations(1, 'female')).toBe('daughter');
    expect(describeDescendantByGenerations(1, 'unknown')).toBe('child');
  });
  it('g=2', () => {
    expect(describeDescendantByGenerations(2, 'male')).toBe('grandson');
    expect(describeDescendantByGenerations(2, 'female')).toBe('granddaughter');
    expect(describeDescendantByGenerations(2, 'unknown')).toBe('grandchild');
  });
  it('g>=3', () => {
    expect(describeDescendantByGenerations(3, 'male')).toBe('great-grandson');
    expect(describeDescendantByGenerations(4, 'female')).toBe(
      '2nd great-granddaughter',
    );
  });
});

describe('describeRelationship — cousins.ged', () => {
  const { graph, model } = buildFrom('cousins.ged');
  const rel = (from: string, to: string) =>
    describeRelationship(graph, model, from, to);

  it('direct ancestors', () => {
    expect(rel('I3', 'I1')).toBe('father');
    expect(rel('I7', 'I1')).toBe('grandfather');
    expect(rel('I11', 'I1')).toBe('great-grandfather');
  });

  it('direct descendants', () => {
    expect(rel('I1', 'I3')).toBe('son');
    expect(rel('I1', 'I7')).toBe('grandson');
    expect(rel('I1', 'I11')).toBe('great-grandson');
  });

  it('siblings (by the OTHER person sex)', () => {
    expect(rel('I4', 'I3')).toBe('brother');
    expect(rel('I3', 'I4')).toBe('sister');
  });

  it('aunt / nephew', () => {
    expect(rel('I7', 'I4')).toBe('aunt');
    expect(rel('I4', 'I7')).toBe('nephew');
  });

  it('great-aunt / great-nephew', () => {
    expect(rel('I11', 'I4')).toBe('great-aunt');
    expect(rel('I4', 'I11')).toBe('great-nephew');
  });

  it('cousins', () => {
    expect(rel('I7', 'I8')).toBe('first cousin');
    expect(rel('I11', 'I12')).toBe('second cousin');
    expect(rel('I11', 'I8')).toBe('first cousin once removed');
  });

  it('self', () => {
    expect(rel('I1', 'I1')).toBe('self');
  });

  it('no traceable relationship', () => {
    expect(rel('I5', 'I6')).toBe('no traceable relationship within this tree');
  });
});

describe('describeRelationship — pedigree-collapse.ged', () => {
  const { graph, model } = buildFrom('pedigree-collapse.ged');
  it('uses the shortest of two paths (g=3)', () => {
    expect(describeRelationship(graph, model, 'I11', 'I1')).toBe('great-grandfather');
  });
});
