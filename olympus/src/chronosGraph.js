import dagre from "@dagrejs/dagre";
import { MarkerType, Position } from "@xyflow/react";
import { ArtifactNode, MergeNode, TimelineNode } from "./chronosNodes.jsx";

// Mid-tone hues stay legible on both the dark and light canvas.
export const chronosColors = {
  cyan: "#06b6d4",
  green: "#10b981",
  violet: "#8b5cf6",
  orange: "#f97316",
  yellow: "#eab308",
  teal: "#14b8a6",
  blue: "#3b82f6",
  red: "#f43f5e",
  gray: "#64748b",
};

const colors = chronosColors;

export const laneMeta = {
  agora: { color: colors.cyan, label: "Ticket" },
  dispatch: { color: colors.green, label: "Dispatch" },
  session: { color: colors.violet, label: "Session" },
  artifact: { color: colors.orange, label: "Artifact" },
  merge: { color: colors.yellow, label: "Merge" },
  phase: { color: colors.teal, label: "Loop" },
  log: { color: colors.blue, label: "Log" },
};

export const chronosNodeTypes = {
  artifact: ArtifactNode,
  merge: MergeNode,
  timeline: TimelineNode,
};

export const statusColors = {
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
        color: meta.color,
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
    style: { stroke: node.data.color, strokeWidth: 1.5 },
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
        style: { stroke: colors.blue, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: colors.blue, width: 14, height: 14 },
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
        style: { stroke: colors.gray, strokeDasharray: "4 5", strokeWidth: 1.5 },
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
