import { useMemo } from 'react';
import { computeFamilyStats } from '@genealogy/core';
import { useStore } from '../state/store.js';
import { primaryName } from '../graph/personDisplay.js';

// "Family" analytics over the focal person's direct ancestors (TRD §9 extension).
// All figures are computed in core from data on hand — no LLM, no network.

function StatCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </div>
      <div className="mt-1 text-gray-800">{children}</div>
    </div>
  );
}

function Big({ children }: { children: React.ReactNode }) {
  return <span className="text-2xl font-bold text-gray-900">{children}</span>;
}

export function FamilyPanel() {
  const model = useStore((s) => s.model);
  const graph = useStore((s) => s.graph);
  const focalPersonId = useStore((s) => s.focalPersonId);

  const stats = useMemo(
    () =>
      model && graph && focalPersonId
        ? computeFamilyStats(model, graph, focalPersonId)
        : null,
    [model, graph, focalPersonId],
  );

  if (!model || !graph || !focalPersonId || !stats) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        Load a file and choose a focal person first.
      </div>
    );
  }

  const focal = model.persons.get(focalPersonId);

  return (
    <div className="h-full overflow-y-auto bg-gray-100 p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Family summary</h2>
          <p className="text-sm text-gray-500">
            Statistics across the direct ancestors of{' '}
            <span className="font-medium">{focal ? primaryName(focal) : 'focal'}</span>.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StatCard title="Ancestors found">
            <Big>{stats.ancestorCount}</Big>
            <span className="ml-2 text-sm text-gray-500">
              across {stats.maxGeneration}{' '}
              {stats.maxGeneration === 1 ? 'generation' : 'generations'}
            </span>
          </StatCard>

          <StatCard title="Ancestor longevity">
            {stats.longevity ? (
              <>
                <Big>{stats.longevity.averageYears}</Big>
                <span className="ml-2 text-sm text-gray-500">
                  avg years (median {stats.longevity.medianYears}, n={stats.longevity.count})
                </span>
              </>
            ) : (
              <span className="text-sm text-gray-400">
                No ancestors with both birth and death years.
              </span>
            )}
          </StatCard>

          <StatCard title="Average family size">
            {stats.averageFamilySize ? (
              <>
                <Big>{stats.averageFamilySize.averageChildren}</Big>
                <span className="ml-2 text-sm text-gray-500">
                  children per couple (over {stats.averageFamilySize.couples}{' '}
                  {stats.averageFamilySize.couples === 1 ? 'couple' : 'couples'})
                </span>
              </>
            ) : (
              <span className="text-sm text-gray-400">No ancestral families found.</span>
            )}
          </StatCard>

          <StatCard title="Military service">
            {stats.military.servedCount > 0 ? (
              <>
                <Big>{stats.military.servedCount}</Big>
                <span className="ml-2 text-sm text-gray-500">
                  ancestor{stats.military.servedCount === 1 ? '' : 's'} with service
                </span>
                {stats.military.byWar.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-sm text-gray-700">
                    {stats.military.byWar.map((w) => (
                      <li key={w.war}>
                        {w.war} <span className="text-gray-400">· {w.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <span className="text-sm text-gray-400">
                No explicit military events among ancestors.
              </span>
            )}
          </StatCard>
        </div>

        <StatCard title="Most common birthplaces">
          {stats.topRegions.length > 0 ? (
            <ul className="space-y-0.5 text-sm text-gray-700">
              {stats.topRegions.map((r) => (
                <li key={r.region}>
                  {r.region} <span className="text-gray-400">· {r.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-sm text-gray-400">No birthplaces recorded.</span>
          )}
        </StatCard>

        <p className="text-[11px] text-gray-400">
          Figures use only data in your file; ancestors with missing dates or places are
          omitted from the relevant stat.
        </p>
      </div>
    </div>
  );
}
