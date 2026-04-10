import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { fetchEditableConfig, saveEditableConfig } from "../lib/api-client";
import type {
  EditableBudgetsConfig,
  EditableConcurrencyConfig,
  EditableOlympusConfig,
  EditableOlympusConfigPatch,
} from "../types/dashboard-state";

export interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  loadConfig?: () => Promise<EditableOlympusConfig>;
  saveConfig?: (payload: EditableOlympusConfigPatch) => Promise<{ ok: boolean; message: string }>;
}

const FALLBACK_CONFIG: EditableOlympusConfig = {
  runtime: "pi",
  thresholds: {
    poll_interval_seconds: 5,
  },
  economics: {
    metering_fallback: "unknown",
    daily_hard_stop_usd: 20,
  },
  concurrency: {
    max_agents: 3,
    max_oracles: 2,
    max_titans: 3,
    max_sentinels: 1,
    max_janus: 1,
  },
  budgets: {
    oracle: { turns: 10, tokens: 80_000 },
    titan: { turns: 20, tokens: 300_000 },
    sentinel: { turns: 8, tokens: 100_000 },
    janus: { turns: 12, tokens: 120_000 },
  },
};

const MOCK_RUN_OBSERVATION_PROFILE: EditableOlympusConfigPatch = {
  concurrency: {
    max_agents: 10,
    max_oracles: 5,
    max_titans: 10,
    max_sentinels: 3,
    max_janus: 2,
  },
  budgets: {
    oracle: { turns: 50, tokens: 500_000 },
    titan: { turns: 100, tokens: 2_000_000 },
    sentinel: { turns: 30, tokens: 500_000 },
    janus: { turns: 50, tokens: 1_000_000 },
  },
};

function toNumber(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function updateConcurrencyField(
  concurrency: EditableConcurrencyConfig,
  key: keyof EditableConcurrencyConfig,
  value: string,
): EditableConcurrencyConfig {
  return {
    ...concurrency,
    [key]: toNumber(value, concurrency[key]),
  };
}

function updateBudgetField(
  budgets: EditableBudgetsConfig,
  caste: keyof EditableBudgetsConfig,
  key: "turns" | "tokens",
  value: string,
): EditableBudgetsConfig {
  return {
    ...budgets,
    [caste]: {
      ...budgets[caste],
      [key]: toNumber(value, budgets[caste][key]),
    },
  };
}

function mergeEditableConfig(
  loaded: Partial<EditableOlympusConfig>,
): EditableOlympusConfig {
  return {
    ...FALLBACK_CONFIG,
    ...loaded,
    thresholds: {
      ...FALLBACK_CONFIG.thresholds,
      ...loaded.thresholds,
    },
    economics: {
      ...FALLBACK_CONFIG.economics,
      ...loaded.economics,
    },
    concurrency: {
      ...FALLBACK_CONFIG.concurrency,
      ...loaded.concurrency,
    },
    budgets: {
      ...FALLBACK_CONFIG.budgets,
      ...loaded.budgets,
      oracle: {
        ...FALLBACK_CONFIG.budgets.oracle,
        ...loaded.budgets?.oracle,
      },
      titan: {
        ...FALLBACK_CONFIG.budgets.titan,
        ...loaded.budgets?.titan,
      },
      sentinel: {
        ...FALLBACK_CONFIG.budgets.sentinel,
        ...loaded.budgets?.sentinel,
      },
      janus: {
        ...FALLBACK_CONFIG.budgets.janus,
        ...loaded.budgets?.janus,
      },
    },
  };
}

export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  const {
    isOpen,
    onClose,
    loadConfig = fetchEditableConfig,
    saveConfig = saveEditableConfig,
  } = props;
  const [draft, setDraft] = useState<EditableOlympusConfig>(FALLBACK_CONFIG);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sourceLabel = useMemo(
    () => (isLoading ? "Loading live config..." : "Live from server"),
    [isLoading],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let active = true;
    setIsLoading(true);
    setError(null);
    setFeedback(null);
    void loadConfig()
      .then((config) => {
        if (!active) return;
        setDraft(mergeEditableConfig(config as Partial<EditableOlympusConfig>));
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        const message = loadError instanceof Error ? loadError.message : "Unable to load config.";
        setError(message);
        setDraft(FALLBACK_CONFIG);
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isOpen, loadConfig]);

  if (!isOpen) {
    return <div data-testid="settings-panel" />;
  }

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const payload: EditableOlympusConfigPatch = {
        concurrency: draft.concurrency,
        budgets: draft.budgets,
      };
      const result = await saveConfig(payload);
      setFeedback(result.message);
    } catch (saveError: unknown) {
      const message = saveError instanceof Error ? saveError.message : "Unable to save config.";
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="settings-overlay"
      data-testid="settings-panel"
      role="dialog"
      aria-label="Settings"
      aria-modal="true"
      onClick={onClose}
      style={{ animation: "fadeIn 250ms ease forwards" }}
    >
      <div
        className="settings-panel"
        onClick={(event) => event.stopPropagation()}
        style={{ animation: "slideIn 400ms ease forwards" }}
      >
        <div className="settings-header">
          <h2>Settings</h2>
          <button
            className="settings-close-btn"
            onClick={onClose}
            aria-label="Close settings"
          >
            {"\u2715"}
          </button>
        </div>

        <div
          style={{
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "#2ec4b6",
            marginBottom: "16px",
            padding: "4px 8px",
            borderRadius: "4px",
            backgroundColor: "rgba(46,196,182,0.1)",
            display: "inline-block",
          }}
        >
          {sourceLabel}
        </div>

        <section style={{ marginBottom: "24px" }}>
          <h3
            style={{
              fontSize: "14px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "#7a8a9e",
              marginBottom: "12px",
            }}
          >
            Runtime
          </h3>
          <ConfigRow label="Adapter" value={draft.runtime} />
          <ConfigRow label="Poll Interval" value={`${draft.thresholds.poll_interval_seconds}s`} />
          <ConfigRow label="Metering Fallback" value={draft.economics.metering_fallback} />
          <ConfigRow
            label="Daily Hard Stop"
            value={draft.economics.daily_hard_stop_usd == null ? "Not set" : `$${draft.economics.daily_hard_stop_usd}`}
          />
        </section>

        <section style={{ marginBottom: "24px" }}>
          <h3
            style={{
              fontSize: "14px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "#7a8a9e",
              marginBottom: "12px",
            }}
          >
            Concurrency
          </h3>
          <NumberField
            label="Max Agents"
            value={draft.concurrency.max_agents}
            onChange={(value) => setDraft((current) => ({
              ...current,
              concurrency: updateConcurrencyField(current.concurrency, "max_agents", value),
            }))}
          />
          <NumberField
            label="Max Oracles"
            value={draft.concurrency.max_oracles}
            onChange={(value) => setDraft((current) => ({
              ...current,
              concurrency: updateConcurrencyField(current.concurrency, "max_oracles", value),
            }))}
          />
          <NumberField
            label="Max Titans"
            value={draft.concurrency.max_titans}
            onChange={(value) => setDraft((current) => ({
              ...current,
              concurrency: updateConcurrencyField(current.concurrency, "max_titans", value),
            }))}
          />
          <NumberField
            label="Max Sentinels"
            value={draft.concurrency.max_sentinels}
            onChange={(value) => setDraft((current) => ({
              ...current,
              concurrency: updateConcurrencyField(current.concurrency, "max_sentinels", value),
            }))}
          />
          <NumberField
            label="Max Janus"
            value={draft.concurrency.max_janus}
            onChange={(value) => setDraft((current) => ({
              ...current,
              concurrency: updateConcurrencyField(current.concurrency, "max_janus", value),
            }))}
          />
        </section>

        <section style={{ marginBottom: "24px" }}>
          <h3
            style={{
              fontSize: "14px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "#7a8a9e",
              marginBottom: "12px",
            }}
          >
            Budget
          </h3>
          <BudgetFields
            caste="oracle"
            label="Oracle"
            budgets={draft.budgets}
            onChange={(nextBudgets) => setDraft((current) => ({ ...current, budgets: nextBudgets }))}
          />
          <BudgetFields
            caste="titan"
            label="Titan"
            budgets={draft.budgets}
            onChange={(nextBudgets) => setDraft((current) => ({ ...current, budgets: nextBudgets }))}
          />
          <BudgetFields
            caste="sentinel"
            label="Sentinel"
            budgets={draft.budgets}
            onChange={(nextBudgets) => setDraft((current) => ({ ...current, budgets: nextBudgets }))}
          />
          <BudgetFields
            caste="janus"
            label="Janus"
            budgets={draft.budgets}
            onChange={(nextBudgets) => setDraft((current) => ({ ...current, budgets: nextBudgets }))}
          />
        </section>

        {error && (
          <div style={{ color: "#e76f51", marginBottom: "12px", fontSize: "13px" }}>
            {error}
          </div>
        )}

        {feedback && (
          <div style={{ color: "#2ec4b6", marginBottom: "12px", fontSize: "13px" }}>
            {feedback}
          </div>
        )}

        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => {
              setDraft((current) => ({
                ...current,
                concurrency: MOCK_RUN_OBSERVATION_PROFILE.concurrency,
                budgets: MOCK_RUN_OBSERVATION_PROFILE.budgets,
              }));
              setFeedback("Applied mock-run observation profile");
            }}
            aria-label="Apply Mock-Run Observation Profile"
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              border: "1px solid #35506b",
              backgroundColor: "transparent",
              color: "#a0b4cc",
              cursor: "pointer",
            }}
          >
            Apply Mock-Run Observation Profile
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            aria-label="Save Settings"
            disabled={isSaving}
            style={{
              padding: "8px 18px",
              borderRadius: "6px",
              border: "none",
              backgroundColor: "#2ec4b6",
              color: "#0d1b2a",
              cursor: isSaving ? "wait" : "pointer",
              fontWeight: 700,
            }}
          >
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 12px",
        backgroundColor: "#253546",
        borderRadius: "8px",
        marginBottom: "8px",
      }}
    >
      <span style={{ fontSize: "14px", color: "#b0b0b0" }}>{label}</span>
      <span style={{ fontSize: "14px", fontWeight: 600, color: "#e0e0e0" }}>{value}</span>
    </div>
  );
}

function NumberField(
  props: {
    label: string;
    value: number;
    onChange: (value: string) => void;
  },
): JSX.Element {
  const { label, value, onChange } = props;

  return (
    <label style={{ display: "block", marginBottom: "10px" }}>
      <span style={{ display: "block", marginBottom: "4px", fontSize: "13px", color: "#b0b0b0" }}>{label}</span>
      <input
        type="number"
        className="command-bar-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
      />
    </label>
  );
}

function BudgetFields(
  props: {
    caste: keyof EditableBudgetsConfig;
    label: string;
    budgets: EditableBudgetsConfig;
    onChange: (nextBudgets: EditableBudgetsConfig) => void;
  },
): JSX.Element {
  const { caste, label, budgets, onChange } = props;

  return (
    <div style={{ marginBottom: "12px", padding: "12px", borderRadius: "8px", backgroundColor: "#18232f" }}>
      <div style={{ marginBottom: "8px", fontSize: "13px", fontWeight: 700, color: "#d0d8e2" }}>{label}</div>
      <NumberField
        label={`${label} Turns`}
        value={budgets[caste].turns}
        onChange={(value) => onChange(updateBudgetField(budgets, caste, "turns", value))}
      />
      <NumberField
        label={`${label} Tokens`}
        value={budgets[caste].tokens}
        onChange={(value) => onChange(updateBudgetField(budgets, caste, "tokens", value))}
      />
    </div>
  );
}
