import { useEffect, useRef, useState } from 'react';
import type { Place, ResolvedPlace } from '@genealogy/core';
import { placeResolver } from '../geo/resolver.js';

export type GeocodeState = Map<string, ResolvedPlace | null>;

/**
 * Resolve a set of places to coordinates via the injected geocoder, one at a
 * time (the resolver self-rate-limits and caches). Results stream into state as
 * they arrive; already-known places are skipped. Keyed by `place.normalized`.
 */
export function useGeocode(places: Place[]): { coords: GeocodeState; pending: number } {
  const [coords, setCoords] = useState<GeocodeState>(new Map());
  const coordsRef = useRef(coords);
  coordsRef.current = coords;
  const [pending, setPending] = useState(0);

  const key = places
    .map((p) => p.normalized)
    .filter(Boolean)
    .sort()
    .join('|');

  useEffect(() => {
    let cancelled = false;
    const todo = places.filter(
      (p) => p.normalized && !coordsRef.current.has(p.normalized),
    );
    if (todo.length === 0) return;
    setPending((n) => n + todo.length);
    void (async () => {
      for (const place of todo) {
        let result: ResolvedPlace | null = null;
        try {
          result = await placeResolver.resolve(place);
        } catch {
          result = null;
        }
        if (cancelled) return;
        setCoords((prev) => {
          const next = new Map(prev);
          next.set(place.normalized, result);
          return next;
        });
        setPending((n) => Math.max(0, n - 1));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run only when the set of places changes (by normalized key).
  }, [key]);

  return { coords, pending };
}
