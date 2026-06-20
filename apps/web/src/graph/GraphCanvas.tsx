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
  const selectPerson = useStore((s) => s.selectPerson);
  const expand = useStore((s) => s.expand);

  const { nodes, edges } = useMemo(() => {
    if (!view) return { nodes: [] as PersonFlowNode[], edges: [] };
    const flow = graphViewToFlow(view, {
      selectedIds: new Set(selectedIds),
      highlightedNodeIds: highlight?.nodeIds,
      highlightedEdgeKeys: highlight?.edgeKeys,
      dimUnhighlighted: highlight !== null,
    });
    return { nodes: layout(flow.nodes, flow.edges), edges: flow.edges };
  }, [view, selectedIds, highlight]);

  const onNodeClick: NodeMouseHandler = (_e, node) => selectPerson(node.id);
  const onNodeDoubleClick: NodeMouseHandler = (_e, node) => expand(node.id, 'all');

  return (
    <ReactFlow
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
