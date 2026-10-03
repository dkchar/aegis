// Flat <-> nested mapping and validation for `.aegis/config.json` edits made
// in Olympus. Mirrors src/config/schema.ts and src/config/load-config.ts so the
// daemon never receives a config it would reject at startup.

export const CASTES = ["oracle", "titan", "sentinel", "janus"];
export const THINKING_LEVELS = ["off", "low", "medium", "high"];
export const RUNTIME_ADAPTERS = ["scripted", "pi", "codex", "claude"];

const NUMBER_FIELDS = {
  "concurrency.max_agents": 1,
  "concurrency.max_oracles": 1,
  "concurrency.max_titans": 1,
  "concurrency.max_sentinels": 1,
  "concurrency.max_janus": 1,
  "thresholds.poll_interval_seconds": 1,
  "thresholds.stuck_warning_seconds": 1,
  "thresholds.stuck_kill_seconds": 1,
  "thresholds.scope_overlap_threshold": 0,
  "thresholds.janus_retry_threshold": 1,
  "janus.max_invocations_per_issue": 1,
  "merge.verify_idle_timeout_seconds": 1,
};

const BOOLEAN_FIELDS = ["thresholds.allow_complex_auto_dispatch", "janus.enabled"];
const TEXT_FIELDS = ["labor.base_path", "git.base_branch"];
const OPTIONAL_TEXT_FIELDS = ["merge.verify_command"];
// Configs written before the merge section existed load these daemon defaults.
const FIELD_DEFAULTS = { "merge.verify_idle_timeout_seconds": 600 };

export function flattenConfig(config) {
  if (!config || typeof config !== "object") return null;
  const flat = { runtime: config.runtime ?? "" };
  for (const caste of CASTES) {
    flat[`models.${caste}`] = config.models?.[caste] ?? "";
  }
  for (const caste of CASTES) {
    flat[`thinking.${caste}`] = config.thinking?.[caste] ?? "";
  }
  for (const key of [...Object.keys(NUMBER_FIELDS), ...BOOLEAN_FIELDS]) {
    const [section, field] = key.split(".");
    flat[key] = String(config[section]?.[field] ?? FIELD_DEFAULTS[key] ?? "");
  }
  for (const key of [...TEXT_FIELDS, ...OPTIONAL_TEXT_FIELDS]) {
    const [section, field] = key.split(".");
    flat[key] = config[section]?.[field] ?? "";
  }
  return flat;
}

function setPath(target, key, value) {
  const [section, field] = key.split(".");
  target[section] = { ...(target[section] ?? {}), [field]: value };
}

/** Returns `{ config, errors }`; `config` is only safe to write when `errors` is empty. */
export function unflattenAndValidateConfig(flat) {
  const errors = [];
  const config = {
    runtime: String(flat.runtime ?? "").trim(),
    models: {},
    thinking: {},
  };

  if (!RUNTIME_ADAPTERS.includes(config.runtime)) {
    errors.push(`runtime must be one of ${RUNTIME_ADAPTERS.join(", ")}.`);
  }

  for (const caste of CASTES) {
    const model = String(flat[`models.${caste}`] ?? "").trim();
    if (!model) errors.push(`models.${caste} is required.`);
    config.models[caste] = model;

    const thinking = String(flat[`thinking.${caste}`] ?? "medium").trim();
    if (!THINKING_LEVELS.includes(thinking)) errors.push(`thinking.${caste} must be one of ${THINKING_LEVELS.join(", ")}.`);
    config.thinking[caste] = thinking;
  }

  for (const [key, minimum] of Object.entries(NUMBER_FIELDS)) {
    const raw = String(flat[key] ?? "").trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value)) {
      errors.push(`${key} must be a number.`);
    } else if (value < minimum) {
      errors.push(`${key} must be at least ${minimum}.`);
    }
    setPath(config, key, value);
  }

  for (const key of BOOLEAN_FIELDS) {
    const raw = String(flat[key] ?? "").trim();
    if (raw !== "true" && raw !== "false") errors.push(`${key} must be true or false.`);
    setPath(config, key, raw === "true");
  }

  for (const key of TEXT_FIELDS) {
    const value = String(flat[key] ?? "").trim();
    if (!value) errors.push(`${key} is required.`);
    setPath(config, key, value);
  }

  for (const key of OPTIONAL_TEXT_FIELDS) {
    setPath(config, key, String(flat[key] ?? "").trim());
  }

  if (config.thresholds && config.thresholds.stuck_kill_seconds < config.thresholds.stuck_warning_seconds) {
    errors.push("thresholds.stuck_kill_seconds must be at least thresholds.stuck_warning_seconds.");
  }

  return { config, errors };
}
