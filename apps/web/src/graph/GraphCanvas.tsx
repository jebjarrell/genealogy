import { useMemo } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '../state/store.js';
import { graphViewToFlow, type PersonFlowNode } from './adapter.js';
import { layout } from './layout.js';
import { PersonNode } from './PersonNode.js';

const nodeTypes = { person: PersonNode };

export function GraphCanvas() {
  const view = useStore((s) => s.view);
  const selectedIds = useStore((s) => s.selectedIds);
  const highlight = useStore((s) => s.highlight);
  const showMarriageEdges = useStore((s) => s.viewOptions.showMarriageEdges);
  const orientation = useStore((s) => s.settings.orientation);
  const selectPerson = useStore((s) => s.selectPerson);
  const expand = useStore((s) => s.expand);

  const { nodes, edges } = useMemo(() => {
    if (!view) return { nodes: [] as PersonFlowNode[], edges: [] };
    // Marriage (spouseOf) edges are display-only clutter; hide unless toggled on.
    // They never drive layout (dagre ranks on parentOf), so dropping them is safe.
    const sourceView = showMarriageEdges
      ? view
      : { ...view, edges: view.edges.filter((e) => e.type !== 'spouseOf') };
    const flow = graphViewToFlow(sourceView, {
      selectedIds: new Set(selectedIds),
      highlightedNodeIds: highlight?.nodeIds,
      highlightedEdgeKeys: highlight?.edgeKeys,
      dimUnhighlighted: highlight !== null,
    });
    return { nodes: layout(flow.nodes, flow.edges, orientation), edges: flow.edges };
  }, [view, selectedIds, highlight, showMarriageEdges, orientation]);

  const onNodeClick: NodeMouseHandler = (_e, node) => selectPerson(node.id);
  // Double-click extends the pedigree (parents only) — keeps the graph to direct
  // ancestors. Descendants/spouses are opt-in via the detail panel and toolbar.
  const onNodeDoubleClick: NodeMouseHandler = (_e, node) => expand(node.id, 'ancestors');

  return (
    <ReactFlow
      // Remount on rotation so the view refits to the re-laid-out graph.
      key={orientation}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={onNodeDoubleClick}
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}
