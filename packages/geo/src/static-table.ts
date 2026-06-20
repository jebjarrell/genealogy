import type { Place, PlaceResolver, ResolvedPlace } from '@genealogy/core';

/**
 * A hand-verified coordinate entry, keyed by a place's normalized string.
 * Coordinates are authoritative; confidence defaults to 1.0 (a verified hit).
 */
export interface StaticTableEntry {
  lat: number;
  lon: number;
  resolvedName?: string;
  confidence?: number;
}

/**
 * Primary, in-memory place resolver (TRD §8.2). Looks up `place.normalized`
 * against a table of hand-verified coordinates and reports them as a `manual`
 * source with high confidence.
 *
 * It also doubles as the growable cache backing for {@link CachingResolver}:
 * downstream resolutions are written back via {@link set} so each unique place
 * is resolved over the network at most once.
 */
export class StaticTableResolver implements PlaceResolver {
  private readonly table: Record<string, StaticTableEntry>;

  constructor(table: Record<string, StaticTableEntry> = {}) {
    // Keep a private shallow copy so external mutation of the seed object
    // (or later mutation of the returned getTable() copy) cannot affect us.
    this.table = { ...table };
  }

  async resolve(place: Place): Promise<ResolvedPlace | null> {
    const entry = this.table[place.normalized];
    if (entry === undefined) {
      return null;
    }

    return {
      lat: entry.lat,
      lon: entry.lon,
      source: 'manual',
      confidence: entry.confidence ?? 1,
      resolvedName: entry.resolvedName ?? place.raw,
    };
  }

  /** Write-back support for the caching chain. */
  set(normalized: string, entry: StaticTableEntry): void {
    this.table[normalized] = entry;
  }

  has(normalized: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.table, normalized);
  }

  /** Returns a shallow copy of the backing table. */
  getTable(): Record<string, StaticTableEntry> {
    return { ...this.table };
  }
}
