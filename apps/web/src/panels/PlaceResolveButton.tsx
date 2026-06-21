import { useState } from 'react';
import type { Place } from '@genealogy/core';
import { placeResolver } from '../geo/resolver.js';

// Geocode a single place on demand via the injected PlaceResolver (TRD §8.3):
// a persistent local cache → OpenStreetMap Nominatim. Place names (not the file)
// are sent to OSM and cached; messy strings are cleaned/coarsened before lookup.
export function PlaceResolveButton({ place }: { place: Place }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [text, setText] = useState('');

  async function resolve() {
    setState('loading');
    const result = await placeResolver.resolve(place);
    setText(
      result
        ? `${result.lat.toFixed(4)}, ${result.lon.toFixed(4)} (${result.source})`
        : "couldn't geocode this place",
    );
    setState('done');
  }

  return (
    <button
      className="text-[11px] text-blue-600 hover:underline disabled:text-gray-400"
      disabled={state === 'loading'}
      onClick={() => void resolve()}
      title="Resolve this place to coordinates via the injected PlaceResolver"
    >
      {state === 'idle' ? '📍 locate' : state === 'loading' ? 'locating…' : text}
    </button>
  );
}
