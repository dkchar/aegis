import dagre from "@dagrejs/dagre";
import { MarkerType, Position } from "@xyflow/react";
import { ArtifactNode, MergeNode, TimelineNode } from "./chronosNodes.jsx";

export const laneMeta = {
  agora: { color: "cyan", label: "Ticket" },
  dispatch: { color: "green", label: "Dispatch" },
  session: { color: "violet", label: "Session" },
  artifact: { color: "orange", label: "Artifact" },
  merge: { color: "yellow", label: "Merge" },
  phase: { color: "teal", label: "Loop" },
  log: { color: "blue", label: "Log" },
};

export const chronosNodeTypes = {
  artifact: ArtifactNode,
  merge: MergeNode,
  timeline: TimelineNode,
};

const colors = {
  cyan: "#22d3ee",
  green: "#22c55e",
  violet: "#a78bfa",
  orange: "#fb923c",
  yellow: "#facc15",
  teal: "#2dd4bf",
  blue: "#38bdf8",
  red: "#fb7185",
  gray: "#64748b",
};

const statusColors = {
  blocked: colors.red,
  failed: colors.red,
  in_progress: colors.yellow,
  ready: colors.blue,
  ready_to_merge: colors.teal,
  done: colors.green,
};

export function buildTimelineFlow(events, selectedId) {
  const nodes = events.map((event, index) => {
    const meta = laneMeta[event.source] ?? laneMeta.log;
    return {
      id: event.id,
      type: "timeline",
      data: {
        color: colors[meta.color] ?? colors.gray,
        event,
        eventId: event.id,
        orientation: "vertical",
        lane: meta.label,
        selected: selectedId === event.id,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      width: 420,
      height: 54,
      position: { x: 0, y: index * 86 },
    };
  });
  const edges = nodes.slice(1).map((node, index) => ({
    id: `timeline-${nodes[index].id}-${node.id}`,
    source: nodes[index].id,
    target: node.id,
    type: "smoothstep",
    style: { stroke: node.data.color, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: node.data.color, width: 14, height: 14 },
  }));

  return layoutFlow({ nodes, edges, rankdir: "TB", nodeSep: 22, rankSep: 42 });
}

export function buildMergeFlow(roots, selectedId) {
  const nodes = [];
  const edges = [];
  const rootIds = [];
  const visit = (ticket, depth = 0) => {
    if (depth === 0) rootIds.push(ticket.id);
    const color = statusColors[ticket.column] ?? colors.gray;
    nodes.push({
      id: ticket.id,
      type: "merge",
      data: {
        color,
        eventId: ticket.id,
        orientation: "horizontal",
        selected: selectedId === ticket.id,
        ticket,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      width: 300,
      height: 66,
      position: { x: depth * 220, y: nodes.length * 96 },
    });
    for (const child of ticket.children ?? []) {
      edges.push({
        id: `${ticket.id}-${child.id}`,
        source: ticket.id,
        target: child.id,
        type: "smoothstep",
        style: { stroke: "#38bdf8", strokeWidth: 2.25 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#38bdf8", width: 14, height: 14 },
      });
      visit(child, depth + 1);
    }
  };
  roots.forEach((root) => visit(root));
  if (rootIds.length > 1) {
    for (let index = 1; index < rootIds.length; index += 1) {
      edges.push({
        id: `order-${rootIds[index - 1]}-${rootIds[index]}`,
        source: rootIds[index - 1],
        target: rootIds[index],
        type: "smoothstep",
        style: { stroke: "#64748b", strokeDasharray: "4 5", strokeWidth: 1.8 },
      });
    }
  }
  return layoutFlow({ nodes, edges, rankdir: "LR", nodeSep: 22, rankSep: 40 });
}

function layoutFlow({ nodes, edges, rankdir, nodeSep, rankSep }) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir, nodesep: nodeSep, ranksep: rankSep, marginx: 24, marginy: 24 });

  for (const node of nodes) graph.setNode(node.id, { width: node.width, height: node.height });
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);

  return {
    nodes: normalizePositions(nodes.map((node) => {
      const point = graph.node(node.id);
      return {
        ...node,
        position: {
          x: point.x - node.width / 2,
          y: point.y - node.height / 2,
        },
      };
    })),
    edges,
  };
}

function normalizePositions(nodes) {
  const minX = Math.min(...nodes.map((node) => node.position.x), 0);
  const minY = Math.min(...nodes.map((node) => node.position.y), 0);
  return nodes.map((node) => ({
    ...node,
    position: {
      x: node.position.x - minX + 24,
      y: node.position.y - minY + 24,
    },
  }));
}
