"use strict";

/**
 * Read each harness's own on-disk model catalog cache.
 *
 * These files are written by the CLI itself after it pulls the account catalog
 * (Claude Code `~/.claude/cache/model-catalog/*.json`, Codex
 * `~/.codex/models_cache.json`, Grok `~/.grok/models_cache.json`). Using them
 * keeps Netcatty's model picker aligned with the live harness catalog —
 * including per-model reasoning levels — instead of frozen UI presets (#3496).
 *
 * All readers are best-effort: missing/unreadable files return null and the
 * caller falls back to the existing SDK / CLI enumeration path.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function resolveHome(env = process.env) {
  return String(env?.HOME || env?.USERPROFILE || os.homedir() || "");
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Claude Code model catalog cache.
 * Shape (v2): { version, fetchedAt, staleAt, catalog: { config: { models: [...] } } }
 * Model row: { id, name, description, section, thinking: { type, effort_options[] } }
 */
function readClaudeModelCatalog(env = process.env) {
  const dir = path.join(resolveHome(env), ".claude", "cache", "model-catalog");
  let entries;
  try {
    entries = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return null;
  }
  let best = null;
  for (const name of entries) {
    const doc = readJsonFile(path.join(dir, name));
    if (!doc || !doc.catalog?.config?.models) continue;
    const fetchedAt = Number(doc.fetchedAt) || 0;
    if (!best || fetchedAt >= best.fetchedAt) {
      best = { fetchedAt, models: doc.catalog.config.models };
    }
  }
  if (!best) return null;

  const models = [];
  for (const row of best.models) {
    const id = row && (row.id || row.modelId || row.value);
    if (!id) continue;
    const thinking = row.thinking && typeof row.thinking === "object" ? row.thinking : null;
    const effortOptions = Array.isArray(thinking?.effort_options) ? thinking.effort_options : [];
    const thinkingLevels = effortOptions
      .map((option) => option?.id)
      .filter((level) => typeof level === "string" && level.length > 0);
    const defaultBadge = effortOptions.find((option) => option?.badge?.message === "Default");
    models.push({
      id,
      name: row.name || row.displayName || row.short_name || id,
      description: row.description,
      thinkingLevels,
      defaultThinkingLevel:
        defaultBadge?.id
        || (thinkingLevels.includes("medium") ? "medium" : thinkingLevels[0] || undefined),
    });
  }
  return models.length > 0 ? models : null;
}

/**
 * Codex models_cache.json (written after the CLI pulls the account catalog).
 * Shape: { fetched_at, client_version, models: [{ slug, display_name,
 *   default_reasoning_level, supported_reasoning_levels: [{ effort }], visibility }] }
 */
function readCodexModelCatalog(env = process.env) {
  const doc = readJsonFile(path.join(resolveHome(env), ".codex", "models_cache.json"));
  const rows = Array.isArray(doc?.models) ? doc.models : null;
  if (!rows) return null;

  const models = [];
  for (const row of rows) {
    const id = row && (row.slug || row.id || row.model);
    if (!id) continue;
    if (row.visibility && row.visibility !== "list") continue;
    const thinkingLevels = (Array.isArray(row.supported_reasoning_levels)
      ? row.supported_reasoning_levels
      : []
    )
      .map((option) => option?.effort || option?.id)
      .filter((level) => typeof level === "string" && level.length > 0);
    models.push({
      id,
      name: row.display_name || row.displayName || id,
      description: row.description,
      thinkingLevels,
      defaultThinkingLevel: row.default_reasoning_level
        || row.defaultReasoningEffort
        || (thinkingLevels.includes("medium") ? "medium" : thinkingLevels[0] || undefined),
    });
  }
  return models.length > 0 ? models : null;
}

/**
 * Grok models_cache.json.
 * Shape: { fetched_at, origin, models: { [id]: { info: { id, name, description,
 *   reasoning_effort, reasoning_efforts: [{ id, default }] } } } }
 */
function readGrokModelCatalog(env = process.env) {
  const doc = readJsonFile(path.join(resolveHome(env), ".grok", "models_cache.json"));
  const rows = doc?.models && typeof doc.models === "object" ? doc.models : null;
  if (!rows) return null;

  const models = [];
  for (const [key, row] of Object.entries(rows)) {
    const info = row && typeof row === "object" ? row.info : null;
    const id = info?.id || info?.model || key;
    if (!id || info?.hidden === true) continue;
    const thinkingLevels = (Array.isArray(info?.reasoning_efforts) ? info.reasoning_efforts : [])
      .map((option) => option?.id || option?.value)
      .filter((level) => typeof level === "string" && level.length > 0);
    const defaultEffort = (Array.isArray(info?.reasoning_efforts) ? info.reasoning_efforts : [])
      .find((option) => option?.default === true);
    models.push({
      id,
      name: info?.name || id,
      description: info?.description,
      thinkingLevels,
      defaultThinkingLevel:
        defaultEffort?.id
        || defaultEffort?.value
        || info?.reasoning_effort
        || (thinkingLevels.includes("high") ? "high" : thinkingLevels[0] || undefined),
    });
  }
  return models.length > 0 ? models : null;
}

module.exports = {
  readClaudeModelCatalog,
  readCodexModelCatalog,
  readGrokModelCatalog,
};
