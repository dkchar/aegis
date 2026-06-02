import { Button, Modal, Paper, Stack, Text } from "@mantine/core";
import { Settings2 } from "lucide-react";
import { dismissConfigDialog, openConfigForMissing } from "./state.js";

export default function SetupDialog({ state, mutate }) {
  if (!state.showConfigDialog || state.configIssues.length === 0) return null;
  return (
    <Modal opened onClose={() => mutate(dismissConfigDialog(state))} title="Finish Config" centered closeButtonProps={{ "aria-label": "Close dialog" }}>
      <Text size="sm" c="dimmed" mb="md">Some runtime selections are not set. Complete them before starting long-running work.</Text>
      <Stack gap="xs" mb="md">
        {state.configIssues.map((key) => (
          <Paper key={key} withBorder radius="sm" p="sm"><Text ff="monospace" size="sm">{key}</Text></Paper>
        ))}
      </Stack>
      <Button color="cyan" leftSection={<Settings2 size={16} />} onClick={() => mutate(openConfigForMissing(state))}>Open Config</Button>
    </Modal>
  );
}
