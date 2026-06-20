import { describeAncestorByGenerations } from '@genealogy/core';
import { useStore } from '../state/store.js';
import { primaryName } from '../graph/personDisplay.js';

// The pedigree-collapse report (TRD §10.5) — the centerpiece, surfaced as a list.
// Each entry: the ancestor, how many ways they are reached, and the relationship
// each path implies (e.g. "great-grandfather via George's line").
export function CollapseReport() {
  const model = useStore((s) => s.model);
  const focalPersonId = useStore((s) => s.focalPersonId);
  const collapsePoints = useStore((s) => s.collapsePoints);
  const showRelationship = useStore((s) => s.showRelationship);
  const highlight = useStore((s) => s.highlight);

  if (!model || !focalPersonId) return null;

  if (collapsePoints.length === 0) {
    return (
      <p className="p-3 text-sm text-gray-400">
        No pedigree collapse detected from the current focal person.
      </p>
    );
  }

  const nameOf = (id: string | undefined) => {
    const p = id ? model.persons.get(id) : undefined;
    return p ? primaryName(p) : 'unknown';
  };

  return (
    <div className="space-y-2 p-3">
      <p className="text-xs text-gray-500">
        {collapsePoints.length} ancestor(s) related to the focal person more than one
        way. Select one to highlight every path.
      </p>
      {collapsePoints.map((cp) => {
        const ancestor = model.persons.get(cp.ancestorId);
        if (!ancestor) return null;
        const active = highlight?.toId === cp.ancestorId;
        return (
          <button
            key={cp.ancestorId}
            onClick={() => showRelationship(focalPersonId, cp.ancestorId)}
            className={`block w-full rounded border p-2 text-left ${
              active
                ? 'border-red-400 bg-red-50'
                : 'border-amber-300 bg-amber-50 hover:bg-amber-100'
            }`}
          >
            <div className="text-sm font-semibold text-gray-900">
              {primaryName(ancestor)}
              <span className="ml-1 text-xs font-normal text-gray-500">
                — reached {cp.pathCount} ways{cp.truncated ? '+' : ''}
              </span>
            </div>
            <ul className="mt-1 space-y-0.5">
              {cp.paths.map((path, i) => (
                <li key={i} className="text-xs text-gray-600">
                  • your {describeAncestorByGenerations(path.length, ancestor.sex)} via{' '}
                  {nameOf(path.steps[1]?.personId)}&rsquo;s line
                </li>
              ))}
            </ul>
          </button>
        );
      })}
    </div>
  );
}
