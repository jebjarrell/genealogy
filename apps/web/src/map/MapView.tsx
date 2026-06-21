import { useEffect, useMemo, useState } from 'react';
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  describeRelationship,
  getAncestors,
  type ResolvedPlace,
} from '@genealogy/core';
import { useStore } from '../state/store.js';
import { primaryName } from '../graph/personDisplay.js';
import { lineageStops, uniquePlaces, type LineageStop } from './lineage.js';
import { useGeocode } from './useGeocode.js';
import { TimeSlider } from './TimeSlider.js';

const EVENT_LABEL: Record<string, string> = {
  birth: 'born',
  death: 'died',
  marriage: 'married',
  residence: 'resided',
  immigration: 'immigrated',
  emigration: 'emigrated',
  census: 'census',
  burial: 'buried',
  baptism: 'baptized',
};

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const key = JSON.stringify(positions);
  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0]!, 6);
      return;
    }
    map.fitBounds(positions, { padding: [40, 40] });
  }, [map, key, positions]);
  return null;
}

// Color a stop from blue (earliest) to red (latest) so direction is readable.
function rampColor(index: number, total: number): string {
  const frac = total <= 1 ? 0 : index / (total - 1);
  return `hsl(${Math.round(220 - 220 * frac)}, 80%, 45%)`;
}

function AncestorSelector() {
  const model = useStore((s) => s.model)!;
  const graph = useStore((s) => s.graph)!;
  const focalPersonId = useStore((s) => s.focalPersonId)!;
  const mapAncestorId = useStore((s) => s.mapAncestorId);
  const setMapAncestor = useStore((s) => s.setMapAncestor);
  const [query, setQuery] = useState('');

  const ancestors = useMemo(() => {
    const ids = getAncestors(graph, focalPersonId);
    const q = query.trim().toLowerCase();
    return ids
      .map((id) => model.persons.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .filter((p) => !q || primaryName(p).toLowerCase().includes(q))
      .slice(0, 40);
  }, [graph, model, focalPersonId, query]);

  if (mapAncestorId) {
    const anc = model.persons.get(mapAncestorId);
    return (
      <div className="text-sm">
        <span className="text-gray-500">Lineage: </span>
        <span className="font-semibold">
          {model.persons.get(focalPersonId)?.names[0]?.full ?? 'focal'}
        </span>
        <span className="text-gray-400"> → </span>
        <span className="font-semibold">{anc ? primaryName(anc) : mapAncestorId}</span>
        {anc && (
          <span className="ml-1 text-xs text-gray-400">
            ({describeRelationship(graph, model, focalPersonId, mapAncestorId)})
          </span>
        )}
        <button
          className="ml-2 text-xs text-blue-700 hover:underline"
          onClick={() => setMapAncestor(null)}
        >
          change
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 text-sm font-semibold text-gray-700">
        Pick an ancestor to map the line to:
      </div>
      <input
        autoFocus
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search ancestors…"
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
      />
      <ul className="mt-1 max-h-48 overflow-y-auto">
        {ancestors.map((p) => (
          <li key={p.id}>
            <button
              className="w-full truncate rounded px-2 py-1 text-left text-sm text-blue-700 hover:bg-blue-50"
              onClick={() => setMapAncestor(p.id)}
            >
              {primaryName(p)}
              <span className="ml-1 text-xs text-gray-400">
                ({describeRelationship(graph, model, focalPersonId, p.id)})
              </span>
            </button>
          </li>
        ))}
        {ancestors.length === 0 && (
          <li className="px-2 py-2 text-sm text-gray-400">No ancestors found.</li>
        )}
      </ul>
    </div>
  );
}

export function MapView() {
  const model = useStore((s) => s.model);
  const graph = useStore((s) => s.graph);
  const focalPersonId = useStore((s) => s.focalPersonId);
  const mapAncestorId = useStore((s) => s.mapAncestorId);

  const stops: LineageStop[] = useMemo(() => {
    if (!model || !graph || !focalPersonId || !mapAncestorId) return [];
    return lineageStops(model, graph, focalPersonId, mapAncestorId);
  }, [model, graph, focalPersonId, mapAncestorId]);

  const places = useMemo(() => uniquePlaces(stops), [stops]);
  const { coords, pending } = useGeocode(places);

  const resolved = useMemo(
    () =>
      stops
        .map((stop) => ({ stop, coord: coords.get(stop.place.normalized) ?? null }))
        .filter((x): x is { stop: LineageStop; coord: ResolvedPlace } => !!x.coord),
    [stops, coords],
  );

  const years = resolved
    .map((x) => x.stop.year)
    .filter((y): y is number => y !== undefined);
  const minYear = years.length ? Math.min(...years) : undefined;
  const maxYear = years.length ? Math.max(...years) : undefined;

  const [year, setYear] = useState<number | undefined>(undefined);
  useEffect(() => setYear(maxYear), [maxYear]);
  const currentYear = year ?? maxYear;

  const visible = resolved.filter(
    (x) =>
      x.stop.year === undefined ||
      currentYear === undefined ||
      x.stop.year <= currentYear,
  );
  const positions = visible.map((x) => [x.coord.lat, x.coord.lon] as [number, number]);

  if (!model || !graph || !focalPersonId) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        Load a file and choose a focal person first.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={[20, 0]}
        zoom={2}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {positions.length > 1 && (
          <Polyline
            positions={positions}
            pathOptions={{ color: '#6b7280', weight: 2 }}
          />
        )}
        {visible.map((x, i) => (
          <CircleMarker
            key={x.stop.event.id}
            center={[x.coord.lat, x.coord.lon]}
            radius={7}
            pathOptions={{
              color: '#fff',
              weight: 1.5,
              fillColor: rampColor(i, visible.length),
              fillOpacity: 0.9,
            }}
          >
            <Tooltip>
              <div className="text-xs">
                <div className="font-semibold">{primaryName(x.stop.person)}</div>
                <div>
                  {EVENT_LABEL[x.stop.event.type] ?? x.stop.event.type}
                  {x.stop.year ? ` ${x.stop.year}` : ''}
                </div>
                <div className="text-gray-500">{x.stop.place.raw}</div>
              </div>
            </Tooltip>
          </CircleMarker>
        ))}
        <FitBounds positions={positions} />
      </MapContainer>

      <div className="absolute left-3 top-3 z-[1000] w-80 max-w-[90%] rounded-lg border border-gray-200 bg-white/95 p-3 shadow">
        <AncestorSelector />
        {mapAncestorId && (
          <div className="mt-2 space-y-1">
            {minYear !== undefined && maxYear !== undefined && (
              <TimeSlider
                min={minYear}
                max={maxYear}
                value={currentYear ?? maxYear}
                onChange={setYear}
              />
            )}
            <div className="text-[11px] text-gray-500">
              {resolved.length} located event(s)
              {pending > 0 && ` · geocoding ${pending}…`}
              {stops.length > 0 && resolved.length === 0 && pending === 0 && (
                <span className="text-amber-700"> · no places could be geocoded</span>
              )}
            </div>
            <div className="text-[10px] text-gray-400">
              Place names are sent to OpenStreetMap for geocoding and cached locally.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
