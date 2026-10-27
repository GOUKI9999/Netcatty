import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { collectSessionIds } from "../../domain/workspace.ts";
import { useSessionState } from "./useSessionState.ts";

type SessionState = ReturnType<typeof useSessionState>;

test("merging a workspace tab with a standalone tab reuses the workspace id (issue #4015 R3)", async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const eventTarget = new EventTarget() as EventTarget & Record<string, unknown>;
  Object.assign(eventTarget, {
    setTimeout,
    clearTimeout,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: eventTarget,
  });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  let state: SessionState | null = null;
  let renderer: ReactTestRenderer | null = null;
  const current = (): SessionState => {
    assert.ok(state);
    return state;
  };
  function Probe() {
    state = useSessionState({ persistSessionRestore: false });
    return null;
  }

  await act(async () => {
    renderer = create(React.createElement(Probe));
  });

  let baseId = "";
  let memberId = "";
  let standaloneId = "";
  await act(async () => {
    baseId = current().createLocalTerminal({ shellName: "01" });
    memberId = current().createLocalTerminal({ shellName: "02" });
    standaloneId = current().createLocalTerminal({ shellName: "03" });
  });

  await act(async () => {
    current().createWorkspaceFromSessions(baseId, memberId, {
      direction: "vertical",
      position: "right",
      targetSessionId: baseId,
    });
  });
  const workspaceId = current().workspaces[0]?.id;
  assert.ok(workspaceId);
  assert.equal(current().sessions.find((s) => s.id === standaloneId)?.workspaceId ?? "", "");

  // Dropping the standalone tab onto a member of the workspace must join the
  // existing workspace — regenerating the id would strand AI chats bound to it.
  await act(async () => {
    current().createWorkspaceFromSessions(standaloneId, memberId, {
      direction: "vertical",
      position: "right",
      targetSessionId: standaloneId,
    });
  });

  assert.equal(current().workspaces.length, 1);
  assert.equal(current().workspaces[0]?.id, workspaceId);
  assert.equal(
    current().sessions.find((s) => s.id === standaloneId)?.workspaceId,
    workspaceId,
  );
  const memberIds = collectSessionIds(current().workspaces[0]!.root);
  assert.ok(memberIds.includes(standaloneId));
  assert.ok(memberIds.includes(memberId));
  // The standalone tab slot is replaced by the workspace tab.
  assert.ok(!current().orderedTabs.includes(standaloneId));

  // Two genuinely standalone tabs still create a fresh workspace.
  let firstStandaloneId = "";
  let secondStandaloneId = "";
  await act(async () => {
    firstStandaloneId = current().createLocalTerminal({ shellName: "04" });
    secondStandaloneId = current().createLocalTerminal({ shellName: "05" });
  });
  await act(async () => {
    current().createWorkspaceFromSessions(firstStandaloneId, secondStandaloneId, {
      direction: "vertical",
      position: "right",
      targetSessionId: firstStandaloneId,
    });
  });

  assert.equal(current().workspaces.length, 2);
  const freshWorkspace = current().workspaces.find((candidate) => candidate.id !== workspaceId);
  assert.ok(freshWorkspace);
  assert.notEqual(freshWorkspace.id, workspaceId);

  await act(async () => {
    renderer?.unmount();
  });
});
