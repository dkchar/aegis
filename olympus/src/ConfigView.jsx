import { Cpu, Gauge, GitBranch, Layers, Save, Settings2, ShieldHalf, TimerReset, Workflow } from "lucide-react";
import { useEffect } from "react";
import { loadModelOptions, loadOlympusState, saveOlympusConfig } from "./api.js";
import { CasteIcon, SectionCard, casteMeta } from "./components/aegis.jsx";
import { Alert, Badge, Button, Card, Combobox, CountBadge, Field, Input, NumberInput, Segmented, Select, cn } from "./components/ui/index.js";
import { Screen } from "./Shell.jsx";
import {
  configMeta,
  getConfigIssues,
  hydrateOlympusState,
  saveConfigSucceeded,
  setConfigSection,
  settings,
  thinkingOptions,
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

const castes = Object.keys(casteMeta);

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

  const fieldProps = { state, mutate, errors };

  return (
    <Screen>
      <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Settings2 className="size-4 text-muted-foreground" aria-hidden="true" />
            Config
            <span className="font-mono text-xs font-normal text-subtle-foreground">.aegis/config.json</span>
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Edits are validated here and again on save; the daemon reads the file on start.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {issues.length > 0 && <Badge tone="danger">{issues.length} required</Badge>}
          {errorCount > 0 && <Badge tone="danger">{errorCount} invalid</Badge>}
          {state.configDirty ? <Badge tone="warning" variant="dot">unsaved changes</Badge> : <Badge tone="success" variant="dot">saved</Badge>}
          <Button variant="outline" size="sm" onClick={resetConfig}><TimerReset />Reset</Button>
          <Button variant="primary" size="sm" onClick={saveConfig} disabled={!state.configDirty || errorCount > 0}><Save />Save</Button>
        </div>
      </Card>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Config sections" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {configSections.map(([section, Icon]) => {
            const sectionErrors = Object.keys(errors).filter((key) => configMeta[key]?.section === section).length
              + issues.filter((key) => configMeta[key]?.section === section).length;
            const active = state.activeConfigSection === section;
            return (
              <button
                key={section}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => mutate(setConfigSection(state, section))}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-left text-[13px] font-medium text-muted-foreground transition-colors hover:bg-surface-raised/60 hover:text-foreground [&>svg]:size-4",
                  active && "bg-surface-raised text-foreground shadow-[inset_0_0_0_1px_var(--border)]",
                )}
              >
                <Icon aria-hidden="true" />
                <span className="flex-1">{section}</span>
                <CountBadge value={sectionErrors} tone="danger" />
              </button>
            );
          })}
        </nav>

        <SectionCard icon={activeSection[1]} title={activeSection[0]} description={activeSection[2]} bodyClassName="grid gap-4">
          {state.activeConfigSection === "Adapter" && runtime && (
            <Alert tone="info" title={`${runtime} adapter`}>{adapterNotes[runtime] ?? "No adapter-specific settings."}</Alert>
          )}
          {state.activeConfigSection === "Runtime" ? (
            <RuntimeSection {...fieldProps} />
          ) : visibleSettings.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No settings for this adapter.</p>
          ) : (
            <div className="grid gap-x-4 gap-y-5 md:grid-cols-2">
              {visibleSettings.map(([key]) => (
                <ConfigField key={key} configKey={key} {...fieldProps} />
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <Alert tone="neutral" title="Runtime source">{state.apiMessage}. Choices mirror supported adapters and typed Aegis config fields.</Alert>
    </Screen>
  );
}

/** Adapter choice, then one row per caste pairing its model with its thinking level. */
function RuntimeSection(props) {
  return (
    <>
      <ConfigField configKey="runtime" className="max-w-sm" {...props} />
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border">
        {castes.map((caste) => (
          <div key={caste} className="grid items-start gap-4 bg-surface px-4 py-3 lg:grid-cols-[11rem_minmax(0,1fr)_auto]">
            <div className="grid gap-0.5 pt-1">
              <span className="inline-flex items-center gap-2 text-[13px] font-medium"><CasteIcon caste={caste} className="size-4" />{casteMeta[caste].label}</span>
              <span className="text-xs text-subtle-foreground">{configMeta[`models.${caste}`]?.description}</span>
            </div>
            <ConfigField configKey={`models.${caste}`} hideDescription {...props} />
            <ConfigField configKey={`thinking.${caste}`} hideDescription {...props} />
          </div>
        ))}
      </div>
    </>
  );
}

function ConfigField({ configKey, state, mutate, errors, className, hideDescription = false }) {
  const meta = configMeta[configKey];
  const value = state.config[configKey];
  const isMissing = meta.required && !String(value ?? "").trim();
  const message = isMissing ? "Required before start" : errors[configKey];
  const segmented = configKey.startsWith("thinking.") || meta.control === "boolean";

  return (
    <Field as={segmented ? "div" : "label"} label={configKey} mono hint={hideDescription ? undefined : meta.description} error={message} className={className}>
      {renderConfigControl(configKey, meta, value, state, Boolean(message), (nextValue) => mutate(updateConfig(state, configKey, nextValue)))}
    </Field>
  );
}

function renderConfigControl(configKey, meta, value, state, invalid, onChange) {
  const common = { "aria-invalid": invalid || undefined, "aria-label": configKey };
  if (configKey.startsWith("thinking.")) {
    return <Segmented size="sm" options={thinkingOptions} value={value} onValueChange={onChange} {...common} />;
  }
  if (meta.control === "select") {
    const options = configKey === "runtime" ? state.adapterOptions : meta.options;
    return <Select value={value} options={options} onValueChange={(nextValue) => onChange(nextValue ?? "")} {...common} />;
  }
  if (meta.control === "model") {
    const runtime = state.config.runtime;
    const modelSet = state.modelOptions[runtime];
    const options = modelSet?.options ?? [];
    const hasCurrentValue = value && !options.some((option) => option.value === value);
    return (
      <Combobox
        value={value}
        placeholder={modelSet?.message || "Select authenticated model"}
        searchPlaceholder="Search models…"
        options={[...(hasCurrentValue ? [{ value, label: value }] : []), ...options]}
        onValueChange={onChange}
        clearable
        {...common}
      />
    );
  }
  if (meta.control === "boolean") {
    return <Segmented size="sm" options={["true", "false"]} value={String(value)} onValueChange={onChange} {...common} />;
  }
  if (meta.control === "number") {
    return <NumberInput min={meta.min} max={meta.max} value={value} onChange={onChange} {...common} />;
  }
  return <Input value={value} onChange={(event) => onChange(event.target.value)} className="font-mono" {...common} />;
}
