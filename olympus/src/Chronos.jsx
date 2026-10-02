import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { Clock3, GitMerge, Waypoints } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "./components/aegis.jsx";
import { Screen } from "./Shell.jsx";
import { Badge, Card, CardTitle, Select } from "./components/ui/index.js";
import { buildChronosMergeTree, buildChronosTimeline } from "./state.js";
import { buildMergeFlow, buildTimelineFlow, chronosColors, chronosNodeTypes, laneMeta } from "./chronosGraph.js";

const mergeLegend = [
  ["parent link", chronosColors.blue],
  ["ticket order", chronosColors.gray],
  ["done", chronosColors.green],
  ["active", chronosColors.yellow],
  ["blocked", chronosColors.red],
];

/** Chronos Flight Recorder (every truth-plane event in order) beside the Agora merge tree. */
export default function Chronos({ state, theme = "dark" }) {
  const timeline = useMemo(() => buildChronosTimeline(state), [state]);
  const mergeTree = useMemo(() => buildChronosMergeTree(state), [state]);
  const [filter, setFilter] = useState("All");
  const [selectedTimelineId, setSelectedTimelineId] = useState("");
  const [selectedMergeId, setSelectedMergeId] = useState("");
  const laneOptions = useMemo(
    () => ["All", ...Array.from(new Set(timeline.map((event) => event.lane).filter(Boolean))).sort()],
    [timeline],
  );
  const visibleTimeline = useMemo(
    () => filter === "All"
      ? timeline
      : timeline.filter((event) => event.lane === filter || event.source === filter.toLowerCase()),
    [filter, timeline],
  );
  const timelineFlow = useMemo(() => buildTimelineFlow(visibleTimeline, selectedTimelineId), [selectedTimelineId, visibleTimeline]);
  const mergeFlow = useMemo(() => buildMergeFlow(mergeTree.roots, selectedMergeId), [mergeTree.roots, selectedMergeId]);

  return (
    <Screen className="xl:grid-cols-2">
      <ChronosPanel
        icon={Clock3}
        title="Chronos Flight Recorder"
        meta={`${visibleTimeline.length} events`}
        legend={Object.values(laneMeta).map((meta) => [meta.label, meta.color])}
        controls={<Select aria-label="Lane" options={laneOptions} value={filter} onValueChange={(value) => setFilter(value || "All")} size="sm" className="w-36" />}
      >
        <FlowCanvas
          emptyTitle="No Chronos events"
          emptyDetail="Select an initialized Aegis workspace or start the daemon from terminal."
          edges={timelineFlow.edges}
          nodes={timelineFlow.nodes}
          fitView={false}
          onSelect={setSelectedTimelineId}
          showMiniMap={false}
          theme={theme}
        />
      </ChronosPanel>
      <ChronosPanel icon={GitMerge} title="Merge Tree" meta={`${mergeTree.stats.tickets} nodes`} legend={mergeLegend}>
        <FlowCanvas
          emptyTitle="No graph records"
          emptyDetail="Agora tickets appear here once the workspace has work loaded."
          edges={mergeFlow.edges}
          nodes={mergeFlow.nodes}
          fitView
          onSelect={setSelectedMergeId}
          showMiniMap={mergeFlow.nodes.length > 18}
          theme={theme}
        />
      </ChronosPanel>
    </Screen>
  );
}

function ChronosPanel({ icon, title, meta, controls = null, legend, children }) {
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <CardTitle icon={icon}>{title}</CardTitle>
          <Badge className="font-mono">{meta}</Badge>
        </div>
        {controls}
      </div>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-sunken/50 px-4 py-2" aria-label={`${title} legend`}>
        {legend.map(([label, color]) => (
          <li key={label} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: color }} aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>
      {children}
    </Card>
  );
}

/** The timeline opens at its start at 1:1; the merge tree fits the whole graph. */
function FlowCanvas({ nodes, edges, onSelect, emptyTitle, emptyDetail, fitView, showMiniMap, theme }) {
  if (nodes.length === 0) {
    return (
      <div className="p-4">
        <EmptyState icon={Waypoints} title={emptyTitle} detail={emptyDetail} className="min-h-[360px]" />
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="h-[calc(100dvh-17rem)] min-h-[560px] bg-surface-sunken/40">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={chronosNodeTypes}
          colorMode={theme}
          defaultViewport={{ x: 80, y: 36, zoom: 1 }}
          fitView={fitView}
          fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
          minZoom={0.4}
          maxZoom={1.35}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          panOnScroll
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => onSelect(node.data.eventId ?? node.id)}
          onPaneClick={() => onSelect("")}
        >
          <Background color="var(--border-strong)" gap={24} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
          {showMiniMap && <MiniMap pannable zoomable nodeStrokeWidth={2} position="bottom-left" />}
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
