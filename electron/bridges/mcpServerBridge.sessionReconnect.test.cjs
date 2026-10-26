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

test('root recovery observes live prompt readiness without executing commands and stops for auth', async (t) => {
  const bridge = require('./mcpServerBridge.cjs');
  t.after(() => bridge.cleanup());
  const runtime = { protocol: 'ssh', _promptTrackTail: 'root@host:~# ', lastIdlePrompt: 'root@host:~# ' };
  bridge.init({ sessions: new Map([['ready', runtime]]), electronModule: null });
  bridge.setPermissionMode('auto');
  bridge.updateSessionMetadata([{ sessionId: 'ready', protocol: 'ssh', connected: true }], 'recover-chat');
  let inspections = 0;
  let auth = false;
  bridge.setVaultAgentInvoker(async (op, params, options) => {
    assert.equal(op, 'session.inspectRecovery');
    assert.equal(params.sessionId, 'ready');
    assert.ok(options.timeoutMs <= 2000);
    inspections++;
    return { ok: true, status: 'connected', waitingForInput: auth };
  });
  assert.equal((await bridge.dispatchBuiltinRpc('session/recover', { sessionId: 'ready', chatSessionId: 'foreign' })).ok, false);
  assert.equal(inspections, 0);
  const result = await bridge.dispatchBuiltinRpc('session/recover', { sessionId: 'ready', chatSessionId: 'recover-chat' });
  assert.equal(result.status, 'ready');
  assert.equal(result.shellReady, true);
  auth = true;
  assert.equal((await bridge.dispatchBuiltinRpc('session/recover', { sessionId: 'ready', chatSessionId: 'recover-chat' })).status, 'needs_input');
  bridge.setPermissionMode('observer');
  assert.equal((await bridge.dispatchBuiltinRpc('session/recover', { sessionId: 'ready', chatSessionId: 'recover-chat' })).ok, false);
  assert.equal(inspections, 2);
});
