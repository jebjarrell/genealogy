import { useEffect, useState } from 'react';

// Year scrubber with play/pause for animating a lineage's migration over time.
export function TimeSlider({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: number;
  onChange: (year: number) => void;
}) {
  const [playing, setPlaying] = useState(false);
  // Span the animation over ~16 steps regardless of the date range.
  const step = Math.max(1, Math.ceil((max - min) / 16));

  useEffect(() => {
    if (!playing) return;
    if (value >= max) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => onChange(Math.min(max, value + step)), 500);
    return () => clearTimeout(id);
  }, [playing, value, max, step, onChange]);

  if (max <= min) return null;

  return (
    <div className="flex items-center gap-2">
      <button
        className="rounded bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-blue-700"
        onClick={() => {
          if (value >= max) onChange(min);
          setPlaying((p) => !p);
        }}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          setPlaying(false);
          onChange(Number(e.target.value));
        }}
        className="flex-1 accent-blue-600"
      />
      <span className="w-12 text-right text-xs font-semibold tabular-nums text-gray-700">
        {value}
      </span>
    </div>
  );
}
