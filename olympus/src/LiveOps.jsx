import { KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Accordion, SimpleGrid, Stack } from "@mantine/core";
import { Activity } from "lucide-react";
import { Screen } from "./Shell.jsx";
import { LogDeck } from "./LogDeck.jsx";
import { CompactSummary } from "./ui.jsx";
import { deriveOpsSummaryItems } from "./supervisionModel.js";
import WorkspacePanel from "./liveOps/WorkspacePanel.jsx";
import { HealthDeck, PhaseEventBoard } from "./liveOps/HealthPanels.jsx";
import { TicketBoard } from "./liveOps/TicketBoard.jsx";

export default function LiveOps({ state, boardTickets, counts, flow, draft, setDraft, addDraft, showDialog, setShowDialog, mutate }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <Screen>
      <CompactSummary icon={Activity} title="Ops Summary" items={deriveOpsSummaryItems(state, counts, flow)} />
      <WorkspacePanel state={state} mutate={mutate} />
      <TicketBoard
        state={state}
        tickets={boardTickets}
        counts={counts}
        draft={draft}
        setDraft={setDraft}
        addDraft={addDraft}
        showDialog={showDialog}
        setShowDialog={setShowDialog}
        mutate={mutate}
        sensors={sensors}
      />
      <Accordion variant="separated">
        <Accordion.Item value="health">
          <Accordion.Control>Health and phase detail</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <SimpleGrid cols={{ base: 1, xl: 2 }}>
                <PhaseEventBoard state={state} />
                <HealthDeck state={state} />
              </SimpleGrid>
              <LogDeck logs={state.logs} compact />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Screen>
  );
}
