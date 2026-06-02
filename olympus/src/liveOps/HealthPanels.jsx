import { Badge, Group, Paper, Stack, Text } from "@mantine/core";
import { Activity, CheckCircle2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { HealthIcon } from "../Shell.jsx";
import { EmptyState, SectionHead, StatusBadge } from "../ui.jsx";
import { phases } from "../state.js";

export function PhaseEventBoard({ state }) {
  return (
    <Paper component="section" withBorder radius="sm" p="md">
      <Stack gap="sm">
        <SectionHead icon={Activity} title="Daemon Events" detail="Phase logs with newest output pinned at the bottom." />
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[64rem] grid-cols-5 gap-3">
            {phases.map((phase) => (
              <PhaseEventColumn key={phase} phase={phase} events={state.loopEvents[phase] || []} />
            ))}
          </div>
        </div>
      </Stack>
    </Paper>
  );
}

function PhaseEventColumn({ phase, events }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [events]);

  return (
    <Paper withBorder radius="sm" mih={320} style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", overflow: "hidden" }}>
      <Group justify="space-between" px="sm" py="xs">
        <Text truncate ff="monospace" size="xs" fw={700} tt="uppercase">{phase}</Text>
        <Badge color="gray" variant="light" size="xs">{events.length}</Badge>
      </Group>
      <div ref={scrollRef} className="terminal-scroll grid max-h-72 content-start gap-2 overflow-y-scroll p-3 font-mono text-xs leading-relaxed">
        {events.length === 0 && (
          <Paper withBorder radius="sm" p="xs"><Text size="xs" c="dimmed">Waiting for {phase} output.</Text></Paper>
        )}
        {events.map(([time, event, detail], index) => (
          <Paper key={`${time}-${event}-${index}`} withBorder radius="sm" p="xs">
            <Stack gap={2}>
              <Text size="xs" ff="monospace" c="dimmed">{time}</Text>
              <Text size="xs" ff="monospace" c="green">{event}</Text>
              <Text size="xs" ff="monospace" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{detail}</Text>
            </Stack>
          </Paper>
        ))}
      </div>
    </Paper>
  );
}

export function HealthDeck({ state }) {
  return (
    <Paper component="section" withBorder radius="sm" p="md">
      <Stack gap="sm">
        <SectionHead icon={CheckCircle2} title="Run Health" detail="Readiness across tracker, state files, merge queue, artifacts, and sessions." />
        <Stack gap="xs">
          {state.healthChecks.length === 0 && <EmptyState title="No health signals" detail="Readiness checks appear after Olympus connects to an Aegis workspace." />}
          {state.healthChecks.map(([label, status, detail]) => (
            <Paper key={label} withBorder radius="sm" p="sm">
              <Group align="flex-start" wrap="nowrap">
                <HealthIcon status={status} />
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Group gap="xs" wrap="wrap"><Text size="sm" fw={700} truncate>{label}</Text><StatusBadge status={status}>{status}</StatusBadge></Group>
                  <Text size="xs" c="dimmed">{detail}</Text>
                </Stack>
              </Group>
            </Paper>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}
