import { useStore } from '../state/store.js';

// Toolbar over the canvas (TRD §10.3): control what the graph shows and reset it.
// Defaults are "direct ancestors only" — toggles add spouses, descendants, and
// marriage edges back when wanted.
export function ViewControls() {
  const viewOptions = useStore((s) => s.viewOptions);
  const setViewOptions = useStore((s) => s.setViewOptions);
  const resetView = useStore((s) => s.resetView);
  const highlight = useStore((s) => s.highlight);
  const clearHighlight = useStore((s) => s.clearHighlight);

  const toggle = (key: 'includeSpouses' | 'showMarriageEdges') =>
    setViewOptions({ [key]: !viewOptions[key] });

  const Chip = ({
    active,
    onClick,
    children,
    title,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
    title?: string;
  }) => (
    <button
      title={title}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
        active
          ? 'border-blue-500 bg-blue-600 text-white'
          : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="pointer-events-auto absolute left-1/2 top-2 z-10 flex -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-full border border-gray-200 bg-white/95 px-2 py-1 shadow">
      <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        Show
      </span>
      <Chip
        active={viewOptions.includeSpouses}
        onClick={() => toggle('includeSpouses')}
        title="Include spouses of people in view (e.g. step-relatives)"
      >
        Spouses
      </Chip>
      <Chip
        active={viewOptions.descendantGenerations > 0}
        onClick={() =>
          setViewOptions({
            descendantGenerations: viewOptions.descendantGenerations > 0 ? 0 : 2,
          })
        }
        title="Include descendants of the focal person"
      >
        Descendants
      </Chip>
      <Chip
        active={viewOptions.showMarriageEdges}
        onClick={() => toggle('showMarriageEdges')}
        title="Draw marriage (spouse) links"
      >
        Marriage links
      </Chip>
      <span className="mx-1 h-4 w-px bg-gray-200" />
      {highlight && (
        <button
          className="rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
          onClick={clearHighlight}
        >
          Clear paths
        </button>
      )}
      <button
        className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
        onClick={resetView}
        title="Reset to the default view for the current focal person"
      >
        Reset view
      </button>
    </div>
  );
}
