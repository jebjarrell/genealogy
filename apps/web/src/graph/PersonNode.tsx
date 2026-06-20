import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStore } from '../state/store.js';
import type { PersonFlowNode } from './adapter.js';
import { lifeSpan, primaryName, primaryPlace } from './personDisplay.js';

// Custom person-card node (TRD §10.2): primary name, birth–death years, primary
// place, plus a focal indicator, a pedigree-collapse marker, and an expand
// affordance when the person has neighbours not yet on screen.
export function PersonNode({ data }: NodeProps<PersonFlowNode>) {
  const model = useStore((s) => s.model);
  const expand = useStore((s) => s.expand);
  const { person, isFocal, isPedigreeCollapsePoint, hasUnexpandedNeighbors } = data;

  const span = model ? lifeSpan(person, model) : '';
  const place = model ? primaryPlace(person, model) : '';

  const border = data.isHighlighted
    ? 'border-red-500 ring-2 ring-red-300'
    : isFocal
      ? 'border-blue-600 ring-2 ring-blue-300'
      : isPedigreeCollapsePoint
        ? 'border-amber-500'
        : data.isSelected
          ? 'border-indigo-500 ring-2 ring-indigo-200'
          : 'border-gray-300';

  return (
    <div
      className={`relative rounded-md border-2 bg-white px-3 py-2 shadow-sm ${border} ${
        data.isDimmed ? 'opacity-30' : ''
      }`}
      style={{ width: 190, height: 76 }}
      title={person.names.map((n) => n.raw).join(' • ')}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />
      <div className="flex items-start justify-between gap-1">
        <div className="truncate text-sm font-semibold text-gray-900">
          {primaryName(person)}
        </div>
        {isPedigreeCollapsePoint && (
          <span
            className="shrink-0 rounded-full bg-amber-100 px-1 text-[10px] font-bold text-amber-700"
            title="Pedigree-collapse point — related to the focal person more than one way"
          >
            ⚭
          </span>
        )}
      </div>
      <div className="mt-0.5 truncate text-xs text-gray-600">{span || '—'}</div>
      {place && <div className="truncate text-[11px] text-gray-400">{place}</div>}
      {isFocal && (
        <span className="absolute -left-1 -top-2 rounded bg-blue-600 px-1 text-[9px] font-bold uppercase text-white">
          focal
        </span>
      )}
      {hasUnexpandedNeighbors && (
        <button
          className="absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-gray-300 bg-white px-1.5 text-xs font-bold text-gray-600 shadow hover:bg-gray-100"
          title="Expand neighbours"
          onClick={(e) => {
            e.stopPropagation();
            expand(person.id, 'all');
          }}
        >
          +
        </button>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
    </div>
  );
}
