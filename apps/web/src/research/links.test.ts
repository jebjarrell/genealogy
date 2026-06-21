import { describe, it, expect } from 'vitest';
import { parseGedcom, buildGraph } from '@genealogy/core';
import minimalGed from '../../../../packages/core/tests/fixtures/minimal.ged?raw';
import {
  researchFacts,
  ancestrySearchUrl,
  familySearchRecordUrl,
  darSearchUrl,
} from './links.js';

const model = parseGedcom(minimalGed);
const graph = buildGraph(model);

describe('researchFacts', () => {
  it('gathers name, birth, parents for a child (I3)', () => {
    const f = researchFacts(model, graph, 'I3')!;
    expect(f.given).toBe('William');
    expect(f.surname).toBe('Smith');
    expect(f.sex).toBe('male');
    expect(f.birthYear).toBe(1925);
    expect(f.birthPlaceParts).toEqual(['Boston', 'Massachusetts', 'United States']);
    expect(f.father).toMatchObject({ given: 'John', surname: 'Smith' });
    expect(f.mother).toMatchObject({ given: 'Jane', surname: 'Doe' });
  });

  it('gathers spouse, child, and death year for a parent (I1)', () => {
    const f = researchFacts(model, graph, 'I1')!;
    expect(f.birthYear).toBe(1900);
    expect(f.deathYear).toBe(1975);
    expect(f.spouses.map((s) => s.surname)).toContain('Doe');
    expect(f.children.map((c) => c.given)).toContain('William');
  });

  it('returns null for an unknown id', () => {
    expect(researchFacts(model, graph, 'NOPE')).toBeNull();
  });
});

describe('ancestrySearchUrl', () => {
  const f = researchFacts(model, graph, 'I3')!;
  const url = ancestrySearchUrl(f);

  it('packs name with an underscore and place with hyphens', () => {
    expect(url).toContain('name=William_Smith');
    expect(url).toContain('birth=1925_Boston-Massachusetts-United+States');
  });

  it('includes parents, gender, and advanced mode', () => {
    expect(url).toContain('father=John_Smith');
    expect(url).toContain('mother=Jane_Doe');
    expect(url).toContain('gender=m');
    expect(url).toContain('searchMode=advanced');
    expect(url.startsWith('https://www.ancestry.com/search/?')).toBe(true);
  });
});

describe('familySearchRecordUrl', () => {
  const f = researchFacts(model, graph, 'I3')!;
  const url = familySearchRecordUrl(f);

  it('uses q.* params and a ±2yr birth window', () => {
    expect(url).toContain('q.givenName=William');
    expect(url).toContain('q.surname=Smith');
    expect(url).toContain('q.birthLikeDate.from=1923');
    expect(url).toContain('q.birthLikeDate.to=1927');
    // commas in the place are percent-encoded by URLSearchParams
    expect(url).toContain('q.birthLikePlace=Boston%2C+Massachusetts%2C+United+States');
  });
});

describe('darSearchUrl', () => {
  it('links to the DAR GRS ancestor search page', () => {
    expect(darSearchUrl()).toBe(
      'https://services.dar.org/Public/DAR_Research/search/?Tab_ID=1',
    );
  });
});
