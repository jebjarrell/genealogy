import type { GenealogyModel, Graph, Place } from '../types/index.js';
import { getAncestors } from '../graph/traversal.js';
import { computeGenerations } from '../graph/generations.js';
import { militaryServiceOf } from '../military/wars.js';
import { firstEvent } from '../model/person-events.js';

// Family analytics over the focal person's DIRECT ANCESTORS (the owner's chosen
// scope). All pure arithmetic on data already in hand — no LLM, no network.

export interface Longevity {
  /** Ancestors with both birth and death years. */
  count: number;
  averageYears: number;
  medianYears: number;
}

export interface RegionTally {
  region: string;
  count: number;
}

export interface FamilySize {
  couples: number;
  averageChildren: number;
}

export interface WarTally {
  war: string;
  count: number;
}

export interface FamilyStats {
  focalId: string;
  /** Distinct direct ancestors found. */
  ancestorCount: number;
  /** Deepest generation reached among ancestors (focal = 0). */
  maxGeneration: number;
  longevity: Longevity | null;
  /** Most common birth regions (states), most frequent first. */
  topRegions: RegionTally[];
  averageFamilySize: FamilySize | null;
  military: { servedCount: number; byWar: WarTally[] };
}

const COUNTRY_TOKENS = new Set([
  'united states',
  'usa',
  'us',
  'u.s.',
  'u.s.a.',
  'united states of america',
  'england',
  'scotland',
  'ireland',
  'wales',
  'uk',
  'u.k.',
  'united kingdom',
  'canada',
]);

/** Best guess at the "state"/region level of a place (drops a trailing country). */
function regionOf(place: Place): string | undefined {
  const parts =
    place.parts && place.parts.length > 0
      ? place.parts
      : place.raw.split(',').map((s) => s.trim());
  const clean = parts.filter((p) => p.length > 0);
  if (clean.length === 0) return undefined;
  const last = clean[clean.length - 1]!;
  if (COUNTRY_TOKENS.has(last.toLowerCase()) && clean.length >= 2) {
    return clean[clean.length - 2];
  }
  return last;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const MAX_REGIONS = 5;

/** Compute analytics across the focal person's direct ancestors. */
export function computeFamilyStats(
  model: GenealogyModel,
  graph: Graph,
  focalId: string,
): FamilyStats {
  const ancestorIds = getAncestors(graph, focalId);
  const gens = computeGenerations(graph, focalId);
  const maxGeneration = ancestorIds.reduce(
    (max, id) => Math.max(max, gens.get(id) ?? 0),
    0,
  );

  // Longevity.
  const ages: number[] = [];
  for (const id of ancestorIds) {
    const person = model.persons.get(id);
    if (!person) continue;
    const birth = firstEvent(person, model, 'birth')?.date?.year;
    const death = firstEvent(person, model, 'death')?.date?.year;
    if (birth !== undefined && death !== undefined && death >= birth) {
      ages.push(death - birth);
    }
  }
  const longevity: Longevity | null =
    ages.length > 0
      ? {
          count: ages.length,
          averageYears: round1(ages.reduce((a, b) => a + b, 0) / ages.length),
          medianYears: median(ages),
        }
      : null;

  // Most common birth region (state).
  const regionCounts = new Map<string, number>();
  for (const id of ancestorIds) {
    const person = model.persons.get(id);
    const place = person ? firstEvent(person, model, 'birth')?.place : undefined;
    const region = place ? regionOf(place) : undefined;
    if (region) regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
  }
  const topRegions: RegionTally[] = [...regionCounts.entries()]
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count || a.region.localeCompare(b.region))
    .slice(0, MAX_REGIONS);

  // Average family size across ancestral couples (each ancestral family once).
  const famIds = new Set<string>();
  for (const id of ancestorIds) {
    const person = model.persons.get(id);
    for (const famId of person?.familyIdsAsSpouse ?? []) famIds.add(famId);
  }
  let totalChildren = 0;
  for (const famId of famIds) {
    totalChildren += model.families.get(famId)?.childIds.length ?? 0;
  }
  const averageFamilySize: FamilySize | null =
    famIds.size > 0
      ? { couples: famIds.size, averageChildren: round1(totalChildren / famIds.size) }
      : null;

  // Military service across ancestors.
  let servedCount = 0;
  const warCounts = new Map<string, number>();
  for (const id of ancestorIds) {
    const service = militaryServiceOf(model, id);
    if (service.served) servedCount += 1;
    for (const war of service.wars) {
      warCounts.set(war.name, (warCounts.get(war.name) ?? 0) + 1);
    }
  }
  const byWar: WarTally[] = [...warCounts.entries()]
    .map(([war, count]) => ({ war, count }))
    .sort((a, b) => b.count - a.count || a.war.localeCompare(b.war));

  return {
    focalId,
    ancestorCount: ancestorIds.length,
    maxGeneration,
    longevity,
    topRegions,
    averageFamilySize,
    military: { servedCount, byWar },
  };
}
