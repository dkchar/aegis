import { KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Activity } from "lucide-react";
import { Screen } from "./Shell.jsx";
import { LogDeck } from "./LogDeck.jsx";
import { CollapsibleSection } from "./components/ui/index.js";
import WorkspacePanel from "./liveOps/WorkspacePanel.jsx";
import { HealthDeck, PhaseEventBoard } from "./liveOps/HealthPanels.jsx";
import { TicketBoard } from "./liveOps/TicketBoard.jsx";

export default function LiveOps({ state, boardTickets, counts, draft, setDraft, addDraft, showDialog, setShowDialog, mutate }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const eventCount = Object.values(state.loopEvents ?? {}).reduce((sum, events) => sum + events.length, 0);

  return (
    <Screen>
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
      <CollapsibleSection icon={Activity} title="Daemon events, run health, and logs" meta={`${eventCount} recent events`}>
        <div className="grid gap-4">
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <PhaseEventBoard state={state} />
            <HealthDeck state={state} />
          </div>
          <LogDeck logs={state.logs} compact />
        </div>
      </CollapsibleSection>
    </Screen>
  );
}
