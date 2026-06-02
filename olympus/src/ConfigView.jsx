import { Alert, Badge, Button, Group, NumberInput, Paper, Select, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { Save, Settings2, TimerReset } from "lucide-react";
import { useEffect } from "react";
import { loadModelOptions, saveOlympusConfig } from "./api.js";
import { Screen } from "./Shell.jsx";
import { SectionHead } from "./ui.jsx";
import {
  configMeta,
  createOlympusState,
  getConfigIssues,
  saveConfigSucceeded,
  setConfigSection,
  settings,
  updateConfig,
  updateModelOptions,
} from "./state.js";

const configSections = ["Runtime", "Concurrency", "Thresholds", "Janus", "Paths", "Adapter"];

export default function Config({ state, mutate }) {
  const visibleSettings = settings.filter(([key]) => configMeta[key]?.section === state.activeConfigSection);
  const issues = getConfigIssues(state.config);
  const runtime = state.config.runtime;

  useEffect(() => {
    if (!runtime || state.modelOptions[runtime]) return undefined;
    let closed = false;
    loadModelOptions(runtime)
      .then((result) => {
        if (!closed) mutate(updateModelOptions(state, runtime, result));
      })
      .catch((error) => {
        if (!closed) mutate({ ...state, toast: error.message, toastKind: "error" });
      });
    return () => {
      closed = true;
    };
  }, [runtime, state.modelOptions, state, mutate]);

  function saveConfig() {
    if (issues.length) {
      mutate({ ...state, configIssues: issues, toast: "Finish required settings", toastKind: "error" });
      return;
    }
    saveOlympusConfig(state.config)
      .then((payload) => mutate(saveConfigSucceeded(state, payload.config ?? state.config)))
      .catch((error) => mutate({ ...state, toast: error.message, toastKind: "error" }));
  }

  return (
    <Screen>
      <Paper component="section" withBorder radius="sm" p="md">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <SectionHead icon={Settings2} title="Config" detail="Set runtime choices, concurrency, thresholds, paths, and adapter timeouts." />
          <Group gap="xs" wrap="wrap">
            {issues.length > 0 && <Badge color="red" variant="light">{issues.length} required</Badge>}
            <Button color="cyan" leftSection={<Save size={16} />} onClick={saveConfig}>Save</Button>
            <Button variant="default" leftSection={<TimerReset size={16} />} onClick={() => mutate({ ...createOlympusState(), activeTab: "config", showConfigDialog: false, toast: "Config reset", toastKind: "success" })}>Reset</Button>
          </Group>
        </Group>
      </Paper>
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="sm">
        <Paper component="aside" withBorder radius="sm" p="xs">
          <Stack gap={4}>
            {configSections.map((section) => (
              <Button
                key={section}
                color="cyan"
                variant={state.activeConfigSection === section ? "light" : "subtle"}
                justify="flex-start"
                onClick={() => mutate(setConfigSection(state, section))}
              >
                {section}
              </Button>
            ))}
          </Stack>
        </Paper>
        <SimpleGrid component="section" cols={{ base: 1, md: 2 }} spacing="sm">
          {visibleSettings.map(([key]) => (
            <ConfigField key={key} configKey={key} value={state.config[key]} state={state} mutate={mutate} />
          ))}
        </SimpleGrid>
      </SimpleGrid>
      <Alert color="cyan" variant="light" title="Runtime source">{state.apiMessage}. Choices mirror detected adapter implementations and typed Aegis config fields.</Alert>
    </Screen>
  );
}

function ConfigField({ configKey, value, state, mutate }) {
  const meta = configMeta[configKey];
  const isMissing = meta.required && !String(value ?? "").trim();

  return (
    <Paper component="label" withBorder radius="sm" p="sm" style={{ borderColor: isMissing ? "var(--mantine-color-red-6)" : undefined }}>
      <Stack gap="xs">
        <Text size="xs" fw={700} ff="monospace" c="dimmed" style={{ overflowWrap: "anywhere" }}>{configKey}</Text>
        {renderConfigControl(configKey, meta, value, state, (nextValue) => mutate(updateConfig(state, configKey, nextValue)))}
        {isMissing && <Text size="xs" fw={700} c="red">Required before start</Text>}
      </Stack>
    </Paper>
  );
}

function renderConfigControl(configKey, meta, value, state, onChange) {
  if (meta.control === "select") {
    const options = configKey === "runtime" ? state.adapterOptions : meta.options;
    return <Select value={value} data={options} onChange={(nextValue) => onChange(nextValue ?? "")} />;
  }
  if (meta.control === "model") {
    const runtime = state.config.runtime;
    const modelSet = state.modelOptions[runtime];
    const options = modelSet?.options ?? [];
    const hasCurrentValue = value && !options.some((option) => option.value === value);
    return (
      <Select
        value={value}
        placeholder={modelSet?.message || "Select authenticated model"}
        data={[...(hasCurrentValue ? [{ value, label: value }] : []), ...options]}
        onChange={(nextValue) => onChange(nextValue ?? "")}
        searchable
        clearable
      />
    );
  }
  if (meta.control === "boolean") {
    return <Select value={String(value)} data={["true", "false"]} onChange={(nextValue) => onChange(nextValue ?? "false")} />;
  }
  if (meta.control === "number") {
    return <NumberInput min={meta.min} max={meta.max} value={value} onChange={onChange} />;
  }
  return <TextInput value={value} onChange={(event) => onChange(event.target.value)} />;
}
