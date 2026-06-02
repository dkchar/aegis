import { Badge, Group, Paper, Select, SimpleGrid, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { Clock3, GitMerge } from "lucide-react";
import { useMemo, useState } from "react";
import { buildChronosMergeTree, buildChronosTimeline } from "./state.js";
import { buildMergeFlow, buildTimelineFlow, chronosNodeTypes, laneMeta } from "./chronosGraph.js";

export default function Chronos({ state }) {
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
    <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="sm">
      <ChronosPanel
        icon={Clock3}
        title="Chronos Flight Recorder"
        meta={`${visibleTimeline.length} events`}
        legend={<TimelineLegend />}
        controls={<Select aria-label="Lane" data={laneOptions} value={filter} onChange={(value) => setFilter(value ?? "All")} w={140} size="xs" />}
      >
        <FlowCanvas
          emptyTitle="No Chronos events"
          emptyDetail="Select an initialized Aegis workspace or start the daemon from terminal."
          edges={timelineFlow.edges}
          fitView={false}
          nodes={timelineFlow.nodes}
          onSelect={setSelectedTimelineId}
          showMiniMap={false}
        />
      </ChronosPanel>
      <ChronosPanel icon={GitMerge} title="Merge Tree" meta={`${mergeTree.stats.tickets} nodes`} legend={<MergeLegend />}>
        <FlowCanvas
          emptyTitle="No graph records"
          emptyDetail="Agora tickets appear here once the workspace has work loaded."
          edges={mergeFlow.edges}
          fitView={false}
          nodes={mergeFlow.nodes}
          onSelect={setSelectedMergeId}
          showMiniMap={mergeFlow.nodes.length > 18}
        />
      </ChronosPanel>
    </SimpleGrid>
  );
}

function ChronosPanel({ icon: Icon, title, meta, controls, legend, children }) {
  return (
    <Paper withBorder radius="sm" bg="dark.9" style={{ minWidth: 0, overflow: "hidden" }}>
      <Stack gap={0}>
        <Group justify="space-between" px="md" py="sm" bg="dark.8" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon color="cyan" variant="light" radius="xl" size="sm"><Icon size={14} /></ThemeIcon>
            <Title order={2} size="sm">{title}</Title>
            <Badge color="gray" variant="light" size="xs">{meta}</Badge>
          </Group>
          {controls}
        </Group>
        {legend}
        {children}
      </Stack>
    </Paper>
  );
}

function TimelineLegend() {
  return (
    <Group gap="xs" px="md" py="xs" wrap="wrap">
      {Object.values(laneMeta).map((meta) => (
        <Badge key={meta.label} color={meta.color} variant="dot" size="xs">{meta.label}</Badge>
      ))}
    </Group>
  );
}

function MergeLegend() {
  return (
    <Group gap="xs" px="md" py="xs" wrap="wrap">
      <Badge color="cyan" variant="dot" size="xs">parent link</Badge>
      <Badge color="gray" variant="dot" size="xs">ticket order</Badge>
      <Badge color="green" variant="dot" size="xs">done</Badge>
      <Badge color="yellow" variant="dot" size="xs">active</Badge>
      <Badge color="red" variant="dot" size="xs">blocked</Badge>
    </Group>
  );
}

function FlowCanvas({ nodes, edges, onSelect, emptyTitle, emptyDetail, fitView, showMiniMap }) {
  if (nodes.length === 0) return <EmptyGraph title={emptyTitle} detail={emptyDetail} />;

  return (
    <ReactFlowProvider>
      <div style={{ height: "calc(100dvh - 17rem)", minHeight: 560 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={chronosNodeTypes}
          defaultViewport={{ x: 80, y: 36, zoom: 1 }}
          fitView={fitView}
          fitViewOptions={{ padding: 0.16 }}
          minZoom={0.55}
          maxZoom={1.35}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          panOnScroll
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => onSelect(node.data.eventId ?? node.id)}
          onPaneClick={() => onSelect("")}
        >
          <Background color="var(--mantine-color-dark-4)" gap={28} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
          {showMiniMap && <MiniMap pannable zoomable nodeStrokeWidth={2} position="bottom-left" />}
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}

function EmptyGraph({ title, detail }) {
  return (
    <Stack align="center" justify="center" mih={360} gap={4} p="xl">
      <Title order={3} size="sm">{title}</Title>
      <Text size="sm" c="dimmed" ta="center">{detail}</Text>
    </Stack>
  );
}
