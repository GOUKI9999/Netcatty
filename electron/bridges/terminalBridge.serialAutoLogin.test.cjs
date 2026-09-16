const test = require("node:test");
const assert = require("node:assert/strict");
const terminalBridge = require("./terminalBridge.cjs");

test("serial auto-login cancels on interactive user input but not automated writes", () => {
  let userInputs = 0;
  const session = {
    type: "serial",
    protocol: "serial",
    encoding: "utf-8",
    serialPort: { write: () => true },
    autoLogin: { handleUserInput: () => { userInputs += 1; } },
  };
  terminalBridge.init({ sessions: new Map([["s", session]]), electronModule: {} });
  try {
    terminalBridge.writeToSession({}, { sessionId: "s", data: "x" });
    assert.equal(userInputs, 1);
    terminalBridge.writeToSession({}, { sessionId: "s", data: "y", automated: true });
    assert.equal(userInputs, 1);
    // xterm replies to ANSI queries (cursor position, DA1, ...) travel through
    // onData without `automated`; they must not cancel auto-login.
    terminalBridge.writeToSession({}, { sessionId: "s", data: "\x1b[24;80R" });
    assert.equal(userInputs, 1);
  } finally {
    terminalBridge.cleanupAllSessions();
  }
});

test("serial sessions without auto-login credentials accept input normally", () => {
  const writes = [];
  const session = {
    type: "serial",
    protocol: "serial",
    encoding: "utf-8",
    serialPort: { write: (d) => writes.push(Buffer.from(d)) },
  };
  terminalBridge.init({ sessions: new Map([["s", session]]), electronModule: {} });
  try {
    terminalBridge.writeToSession({}, { sessionId: "s", data: "ls\r" });
    assert.deepEqual(writes.map((b) => b.toString()), ["ls\r"]);
  } finally {
    terminalBridge.cleanupAllSessions();
  }
});
