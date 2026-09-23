const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  readClaudeModelCatalog,
  readCodexModelCatalog,
  readGrokModelCatalog,
} = require("./nativeModelCatalog.cjs");

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-model-catalog-"));
}

test("readClaudeModelCatalog maps catalog.config.models with per-model thinking levels", () => {
  const home = tempHome();
  const dir = path.join(home, ".claude", "cache", "model-catalog");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "a-cc.json"),
    JSON.stringify({
      version: 2,
      fetchedAt: 100,
      staleAt: 200,
      catalog: {
        config: {
          id: "cc",
          models: [
            {
              id: "claude-opus-5-5",
              name: "Opus 5.5",
              description: "Most capable",
              thinking: {
                type: "effort",
                effort_options: [
                  { id: "low", name: "Low" },
                  { id: "medium", name: "Medium", badge: { message: "Default" } },
                  { id: "high", name: "High" },
                ],
              },
            },
            {
              id: "claude-haiku-4-5",
              name: "Haiku 4.5",
              thinking: { type: "none" },
            },
          ],
        },
      },
    }),
    "utf8",
  );
  // Newer cache wins.
  fs.writeFileSync(
    path.join(dir, "b-cc.json"),
    JSON.stringify({
      version: 2,
      fetchedAt: 300,
      catalog: {
        config: {
          id: "cc",
          models: [{ id: "claude-sonnet-5", name: "Sonnet 5" }],
        },
      },
    }),
    "utf8",
  );

  const models = readClaudeModelCatalog({ HOME: home, USERPROFILE: home });
  assert.equal(models.length, 1);
  assert.equal(models[0].id, "claude-sonnet-5");
  assert.equal(models[0].name, "Sonnet 5");

  // Drop the newer file so the first catalog is selected.
  fs.unlinkSync(path.join(dir, "b-cc.json"));
  const older = readClaudeModelCatalog({ HOME: home, USERPROFILE: home });
  assert.deepEqual(
    older.map((m) => m.id),
    ["claude-opus-5-5", "claude-haiku-4-5"],
  );
  assert.deepEqual(older[0].thinkingLevels, ["low", "medium", "high"]);
  assert.equal(older[0].defaultThinkingLevel, "medium");
  assert.deepEqual(older[1].thinkingLevels, []);
});

test("readCodexModelCatalog maps slug/display_name/reasoning levels and skips non-list rows", () => {
  const home = tempHome();
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".codex", "models_cache.json"),
    JSON.stringify({
      fetched_at: "2026-09-23T00:00:00Z",
      client_version: "0.156.1",
      models: [
        {
          slug: "gpt-6-astra",
          display_name: "GPT-6-Astra",
          default_reasoning_level: "medium",
          supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
          visibility: "list",
        },
        {
          slug: "hidden-model",
          display_name: "Hidden",
          visibility: "hidden",
        },
      ],
    }),
    "utf8",
  );

  const models = readCodexModelCatalog({ HOME: home, USERPROFILE: home });
  assert.deepEqual(models, [
    {
      id: "gpt-6-astra",
      name: "GPT-6-Astra",
      description: undefined,
      thinkingLevels: ["low", "medium", "high"],
      defaultThinkingLevel: "medium",
    },
  ]);
});

test("readGrokModelCatalog maps models[id].info and drops hidden rows", () => {
  const home = tempHome();
  fs.mkdirSync(path.join(home, ".grok"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".grok", "models_cache.json"),
    JSON.stringify({
      fetched_at: "2026-09-23T00:00:00Z",
      origin: "https://cli-chat-proxy.grok.com/v1/models",
      models: {
        "grok-4.7": {
          info: {
            id: "grok-4.7",
            name: "Grok 4.7",
            description: "Latest",
            reasoning_effort: "high",
            reasoning_efforts: [
              { id: "xhigh", default: false },
              { id: "high", default: true },
              { id: "medium", default: false },
            ],
          },
        },
        "grok-hidden": {
          info: { id: "grok-hidden", name: "Hidden", hidden: true },
        },
      },
    }),
    "utf8",
  );

  const models = readGrokModelCatalog({ HOME: home, USERPROFILE: home });
  assert.deepEqual(models, [
    {
      id: "grok-4.7",
      name: "Grok 4.7",
      description: "Latest",
      thinkingLevels: ["xhigh", "high", "medium"],
      defaultThinkingLevel: "high",
    },
  ]);
});

test("readers return null when caches are missing", () => {
  const home = tempHome();
  const env = { HOME: home, USERPROFILE: home };
  assert.equal(readClaudeModelCatalog(env), null);
  assert.equal(readCodexModelCatalog(env), null);
  assert.equal(readGrokModelCatalog(env), null);
});
