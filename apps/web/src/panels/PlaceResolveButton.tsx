import { useState } from 'react';
import type { Place } from '@genealogy/core';
import { placeResolver } from '../geo/resolver.js';

// Exercises the injected PlaceResolver seam (TRD §8.3). In Step One the no-op
// resolver returns null, so this reports "no coordinates" — but it proves the
// app injects and calls a resolver behind the interface, ready for Step Two.
export function PlaceResolveButton({ place }: { place: Place }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [text, setText] = useState('');

  async function resolve() {
    setState('loading');
    const result = await placeResolver.resolve(place);
    setText(
      result
        ? `${result.lat.toFixed(4)}, ${result.lon.toFixed(4)} (${result.source})`
        : 'no coordinates (Step One resolver is a no-op)',
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
