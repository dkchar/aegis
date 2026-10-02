import { Settings2 } from "lucide-react";
import { Button, Code, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./components/ui/index.js";
import { dismissConfigDialog, openConfigForMissing } from "./state.js";

export default function SetupDialog({ state, mutate }) {
  const open = state.showConfigDialog && state.configIssues.length > 0;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && mutate(dismissConfigDialog(state))}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Finish Config</DialogTitle>
          <DialogDescription>Some runtime selections are not set. Complete them before starting long-running work.</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1.5">
          {state.configIssues.map((key) => (
            <li key={key}><Code>{key}</Code></li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="primary" onClick={() => mutate(openConfigForMissing(state))}>
            <Settings2 />
            Open Config
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
