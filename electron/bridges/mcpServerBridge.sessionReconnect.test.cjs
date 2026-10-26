"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isolateCliDiscoveryFile } = require("./cliDiscoveryTestIsolation.cjs");
isolateCliDiscoveryFile();

test("live bridge reconnect requires scope, respects cancellation and never grants close ownership", async (t) => {
  require("../shared/aiPrivacyService.cjs").configure({ enabled: false });
  const bridge = require("./mcpServerBridge.cjs");
  t.after(() => bridge.cleanup());
  bridge.init({ sessions: new Map(), electronModule: null });
  bridge.setPermissionMode("auto");
  let calls = 0;
  bridge.setVaultAgentInvoker(async (op, params) => {
    assert.equal(op, "session.reconnect");
    assert.equal(params.sessionId, "s");
    calls++;
    return { ok: true, started: true, sessionId: "s", status: "reconnecting" };
  });
  bridge.updateSessionMetadata([{ sessionId: "s", connected: false, protocol: "ssh" }], "chat");
  assert.equal((await bridge.dispatchBuiltinRpc("session/reconnect", { sessionId: "s", chatSessionId: "other" })).ok, false);
  assert.equal(calls, 0);
  const result = await bridge.dispatchBuiltinRpc("session/reconnect", { sessionId: "s", chatSessionId: "chat" });
  assert.equal(result.started, true);
  assert.equal(calls, 1);
  const close = await bridge.dispatchBuiltinRpc("session/close", { sessionId: "s", chatSessionId: "chat" });
  assert.equal(close.ok, false);
  bridge.setChatSessionCancelled("chat", true);
  assert.match((await bridge.dispatchBuiltinRpc("session/reconnect", { sessionId: "s", chatSessionId: "chat" })).error, /cancelled/i);
  assert.equal(calls, 1);
});
