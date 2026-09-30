import { Alert, Badge, Button, Grid, Group, NavLink, NumberInput, Paper, Select, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { Cpu, Gauge, GitBranch, Layers, Save, Settings2, ShieldHalf, TimerReset, Workflow } from "lucide-react";
import { useEffect } from "react";
import { loadModelOptions, loadOlympusState, saveOlympusConfig } from "./api.js";
import { Screen } from "./Shell.jsx";
import { Panel } from "./ui.jsx";
import {
  configMeta,
  getConfigIssues,
  hydrateOlympusState,
  saveConfigSucceeded,
  setConfigSection,
  settings,
  updateConfig,
  updateModelOptions,
} from "./state.js";

const configSections = [
  ["Runtime", Cpu, "Adapter, models, and thinking levels per caste."],
  ["Concurrency", Layers, "Session caps across the swarm and per caste."],
  ["Thresholds", Gauge, "Loop cadence, stuck-session limits, and routing policy."],
  ["Janus", Workflow, "Merge-boundary escalation."],
  ["Paths", GitBranch, "Labor worktrees and the integration branch."],
  ["Adapter", ShieldHalf, "Environment overrides for the selected adapter."],
];

const adapterNotes = {
  claude: "Claude Code runs each caste as a headless `claude -p` session. Sign in with `claude` once before starting.",
  codex: "Codex runs each caste through `codex exec`. Run Codex once so its model cache exists.",
  pi: "Pi runs in-process with typed artifact tools and needs Pi provider settings.",
};

export default function Config({ state, mutate }) {
  const runtime = state.config.runtime;
  const visibleSettings = settings.filter(([key]) => {
    const meta = configMeta[key];
    return meta?.section === state.activeConfigSection && (!meta.adapter || meta.adapter === runtime);
  });
  const issues = getConfigIssues(state.config);
  const errors = state.configErrors ?? {};
  const errorCount = Object.keys(errors).length;
  const activeSection = configSections.find(([section]) => section === state.activeConfigSection) ?? configSections[0];

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
    if (issues.length || errorCount) {
      mutate({ ...state, configIssues: issues, toast: "Fix highlighted settings before saving", toastKind: "error" });
      return;
    }
    saveOlympusConfig(state.config)
      .then((payload) => mutate(saveConfigSucceeded(state, payload.config ?? state.config)))
      .catch((error) => mutate({ ...state, toast: error.message, toastKind: "error" }));
  }

  function resetConfig() {
    loadOlympusState()
      .then((payload) => mutate({
        ...hydrateOlympusState({ ...state, configDirty: false }, payload),
        activeTab: "config",
        showConfigDialog: false,
        toast: "Config reset to workspace file",
        toastKind: "success",
      }))
      .catch((error) => mutate({ ...state, toast: error.message, toastKind: "error" }));
  }

  return (
    <Screen>
      <Panel
        icon={Settings2}
        title="Config"
        detail="Edits are validated here and again on save; the daemon reads .aegis/config.json on start."
        actions={(
          <Group gap="xs" wrap="wrap">
            {issues.length > 0 && <Badge color="red" variant="light">{issues.length} required</Badge>}
            {errorCount > 0 && <Badge color="red" variant="light">{errorCount} invalid</Badge>}
            {state.configDirty && <Badge color="yellow" variant="light">unsaved</Badge>}
            <Button leftSection={<Save size={16} />} onClick={saveConfig} disabled={!state.configDirty || errorCount > 0}>Save</Button>
            <Button variant="default" leftSection={<TimerReset size={16} />} onClick={resetConfig}>Reset</Button>
          </Group>
        )}
      />
      <Grid gutter="sm">
        <Grid.Col span={{ base: 12, md: 3 }}>
          <Paper component="aside" withBorder p="xs">
            <Stack gap={2}>
              {configSections.map(([section, Icon]) => {
                const sectionErrors = Object.keys(errors).filter((key) => configMeta[key]?.section === section).length
                  + issues.filter((key) => configMeta[key]?.section === section).length;
                return (
                  <NavLink
                    key={section}
                    label={section}
                    leftSection={<Icon size={16} />}
                    rightSection={sectionErrors > 0 ? <Badge size="xs" color="red" circle>{sectionErrors}</Badge> : null}
                    active={state.activeConfigSection === section}
                    onClick={() => mutate(setConfigSection(state, section))}
                    variant="light"
                    style={{ borderRadius: "var(--mantine-radius-md)" }}
                  />
                );
              })}
            </Stack>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 9 }}>
          <Stack gap="sm">
            <Text size="sm" c="dimmed">{activeSection[2]}</Text>
            {state.activeConfigSection === "Adapter" && runtime && (
              <Alert color="aegis" variant="light" title={`${runtime} adapter`}>{adapterNotes[runtime] ?? "No adapter-specific settings."}</Alert>
            )}
            {visibleSettings.length === 0 && <Text size="sm" c="dimmed">No settings for this adapter.</Text>}
            <SimpleGrid component="section" cols={{ base: 1, md: 2 }} spacing="sm">
              {visibleSettings.map(([key]) => (
                <ConfigField key={key} configKey={key} value={state.config[key]} error={errors[key]} state={state} mutate={mutate} />
              ))}
            </SimpleGrid>
          </Stack>
        </Grid.Col>
      </Grid>
      <Alert color="gray" variant="light" title="Runtime source">{state.apiMessage}. Choices mirror supported adapters and typed Aegis config fields.</Alert>
    </Screen>
  );
}

function ConfigField({ configKey, value, error, state, mutate }) {
  const meta = configMeta[configKey];
  const isMissing = meta.required && !String(value ?? "").trim();
  const message = isMissing ? "Required before start" : error;

  return (
    <Paper component="label" withBorder p="sm" style={{ borderColor: message ? "var(--mantine-color-red-6)" : undefined }}>
      <Stack gap={6}>
        <Text size="xs" fw={700} ff="monospace" c="dimmed" style={{ overflowWrap: "anywhere" }}>{configKey}</Text>
        {renderConfigControl(configKey, meta, value, state, (nextValue) => mutate(updateConfig(state, configKey, nextValue)))}
        {meta.description && <Text size="xs" c="dimmed">{meta.description}</Text>}
        {message && <Text size="xs" fw={700} c="red">{message}</Text>}
      </Stack>
    </Paper>
  );
}

function renderConfigControl(configKey, meta, value, state, onChange) {
  if (meta.control === "select") {
    const options = configKey === "runtime" ? state.adapterOptions : meta.options;
    return <Select value={value} data={options} onChange={(nextValue) => onChange(nextValue ?? "")} allowDeselect={false} />;
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
    return <Select value={String(value)} data={["true", "false"]} onChange={(nextValue) => onChange(nextValue ?? "false")} allowDeselect={false} />;
  }
  if (meta.control === "number") {
    return <NumberInput min={meta.min} max={meta.max} value={value} onChange={(nextValue) => onChange(String(nextValue ?? ""))} />;
  }
  return <TextInput value={value} onChange={(event) => onChange(event.target.value)} />;
}
