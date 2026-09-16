import test from "node:test";
import assert from "node:assert/strict";

import { createTerminalSessionStarters } from "./createTerminalSessionStarters";

const noop = () => undefined;
const ENCRYPTED_CREDENTIAL_PLACEHOLDER = "enc:v1:djEwdGVzdAAAAAAAAAAAAAAAAA==";

const buildBackend = (overrides: Partial<Record<string, unknown>> = {}) => ({
  backendAvailable: () => true,
  telnetAvailable: () => true,
  moshAvailable: () => true,
  localAvailable: () => true,
  serialAvailable: () => true,
  execAvailable: () => true,
  startSSHSession: async () => "ssh-session",
  startTelnetSession: async () => "telnet-session",
  startMoshSession: async () => "mosh-session",
  startLocalSession: async () => "local-session",
  startSerialSession: async () => "serial-session",
  execCommand: async () => ({}),
  onSessionData: () => noop,
  onSessionExit: () => noop,
  onChainProgress: () => noop,
  writeToSession: noop,
  resizeSession: noop,
  ...overrides,
});

const buildCtx = (backend: unknown, extra: Record<string, unknown> = {}) => ({
  host: {
    id: "serial-1",
    label: "Serial: ttyUSB0",
    hostname: "/dev/ttyUSB0",
    protocol: "serial",
    charset: "UTF-8",
  },
  keys: [],
  identities: [],
  sessionId: "session-1",
  serialConfig: {
    path: "/dev/ttyUSB0",
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
  },
  terminalSettings: {},
  terminalBackend: backend,
  sessionRef: { current: null },
  hasConnectedRef: { current: false },
  hasRunStartupCommandRef: { current: false },
  disposeDataRef: { current: null },
  disposeExitRef: { current: null },
  fitAddonRef: { current: null },
  serializeAddonRef: { current: null },
  pendingAuthRef: { current: null },
  bootEpochRef: { current: 0 },
  updateStatus: noop,
  setStatus: noop,
  setError: noop,
  setNeedsAuth: noop,
  setAuthRetryMessage: noop,
  setAuthPassword: noop,
  setProgressLogs: noop,
  setProgressValue: noop,
  ...extra,
});

const term = {
  cols: 120,
  rows: 32,
  write: noop,
  writeln: noop,
  scrollToBottom: noop,
};

test("startSerial passes saved host credentials for auto-login", async () => {
  let capturedOptions: Record<string, unknown> | null = null;
  const backend = buildBackend({
    startSerialSession: async (options: Record<string, unknown>) => {
      capturedOptions = options;
      return "serial-session";
    },
  });

  await createTerminalSessionStarters(buildCtx(backend, {
    host: {
      id: "serial-1",
      label: "Serial: ttyUSB0",
      hostname: "/dev/ttyUSB0",
      protocol: "serial",
      username: "admin",
      password: "secret",
    },
  }) as never).startSerial(term as never);

  assert.ok(capturedOptions);
  assert.equal(capturedOptions.username, "admin");
  assert.equal(capturedOptions.password, "secret");
});

test("startSerial omits credentials when none are saved", async () => {
  let capturedOptions: Record<string, unknown> | null = null;
  const backend = buildBackend({
    startSerialSession: async (options: Record<string, unknown>) => {
      capturedOptions = options;
      return "serial-session";
    },
  });

  await createTerminalSessionStarters(buildCtx(backend) as never).startSerial(term as never);

  assert.ok(capturedOptions);
  assert.equal(capturedOptions.username, undefined);
  assert.equal("password" in capturedOptions, false);
});

test("startSerial skips an undecryptable saved password", async () => {
  let capturedOptions: Record<string, unknown> | null = null;
  const backend = buildBackend({
    startSerialSession: async (options: Record<string, unknown>) => {
      capturedOptions = options;
      return "serial-session";
    },
  });

  await createTerminalSessionStarters(buildCtx(backend, {
    host: {
      id: "serial-1",
      hostname: "/dev/ttyUSB0",
      protocol: "serial",
      username: "",
      password: ENCRYPTED_CREDENTIAL_PLACEHOLDER,
    },
  }) as never).startSerial(term as never);

  assert.ok(capturedOptions);
  assert.equal("username" in capturedOptions, false);
  assert.equal("password" in capturedOptions, false);
});

test("startSerial waits for auto-login before running the startup command", async () => {
  const writtenCommands: string[] = [];
  const executedCommands: string[] = [];
  let autoLoginComplete: ((evt: { sessionId: string }) => void) | null = null;
  let resolveCommand: (() => void) | null = null;
  const commandWritten = new Promise<void>((resolve) => {
    resolveCommand = resolve;
  });

  const backend = buildBackend({
    startSerialSession: async () => "serial-session",
    onTelnetAutoLoginComplete: (
      _sessionId: string,
      cb: (evt: { sessionId: string }) => void,
    ) => {
      autoLoginComplete = cb;
      return noop;
    },
    onTelnetAutoLoginCancelled: () => noop,
    writeToSession: (_sessionId: string, data: string) => {
      writtenCommands.push(data);
      resolveCommand?.();
    },
  });

  const ctx = buildCtx(backend, {
    host: {
      id: "serial-1",
      hostname: "/dev/ttyUSB0",
      protocol: "serial",
      username: "admin",
      password: "secret",
      startupCommand: "show version",
    },
    onCommandExecuted: (command: string) => {
      executedCommands.push(command);
    },
  });

  await createTerminalSessionStarters(ctx as never).startSerial(term as never);
  assert.ok(autoLoginComplete);

  // The startup command must not fire on the default 600ms delay while the
  // main-process auto-login is still answering prompts.
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.deepEqual(writtenCommands, []);
  assert.deepEqual(executedCommands, []);

  autoLoginComplete?.({ sessionId: "session-1" });

  await Promise.race([
    commandWritten,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timed out waiting for startup command")), 1000),
    ),
  ]);
  assert.deepEqual(writtenCommands, ["show version\r"]);
  assert.deepEqual(executedCommands, ["show version"]);
});

test("startSerial runs the startup command without waiting when no credentials are saved", async () => {
  const writtenCommands: string[] = [];
  const backend = buildBackend({
    startSerialSession: async () => "serial-session",
    writeToSession: (_sessionId: string, data: string) => {
      writtenCommands.push(data);
    },
  });

  const ctx = buildCtx(backend, {
    host: {
      id: "serial-1",
      hostname: "/dev/ttyUSB0",
      protocol: "serial",
      startupCommand: "show version",
    },
  });

  await createTerminalSessionStarters(ctx as never).startSerial(term as never);

  await Promise.race([
    new Promise<void>((resolve) => {
      const tick = () => {
        if (writtenCommands.length > 0) {
          resolve();
          return;
        }
        setTimeout(tick, 20);
      };
      tick();
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timed out waiting for startup command")), 2000),
    ),
  ]);
  assert.deepEqual(writtenCommands, ["show version\r"]);
});
