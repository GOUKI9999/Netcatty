const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const { connectClient } = require("./netcattyRpcClient.cjs");
const { TOOL_CLI_DISCOVERY_ENV_VAR } = require("./discoveryPath.cjs");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Minimal NDJSON bridge stand-in: answers auth/verify (and anything else)
// with an empty success result, which is all connectClient needs.
function startFakeBridge() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        buffer += chunk;
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (!line.trim()) continue;
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message?.id == null) continue;
          const result = message.method === "auth/verify" ? { ok: true } : {};
          socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
        }
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

// Reserve a port and release it so connections to it are refused, simulating
// a bridge that died after the CLI read the discovery file.
function getDeadPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function writeDiscoveryFile(discoveryPath, port, token) {
  fs.writeFileSync(discoveryPath, `${JSON.stringify({ port, token, pid: 424242 })}\n`);
}

function setupDiscoveryEnv(t, discoveryPath) {
  const previous = process.env[TOOL_CLI_DISCOVERY_ENV_VAR];
  process.env[TOOL_CLI_DISCOVERY_ENV_VAR] = discoveryPath;
  t.after(() => {
    if (previous === undefined) {
      delete process.env[TOOL_CLI_DISCOVERY_ENV_VAR];
    } else {
      process.env[TOOL_CLI_DISCOVERY_ENV_VAR] = previous;
    }
  });
}

function countConnectAttempts(t) {
  const original = net.createConnection;
  let attempts = 0;
  net.createConnection = (...args) => {
    attempts += 1;
    return original(...args);
  };
  t.after(() => {
    net.createConnection = original;
  });
  return () => attempts;
}

test("connectClient retries with a refreshed discovery file after a stale-port failure", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-cli-connect-test-"));
  const discoveryPath = path.join(dir, "discovery.json");
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  setupDiscoveryEnv(t, discoveryPath);
  const getAttempts = countConnectAttempts(t);

  const deadPort = await getDeadPort();
  const { server, port: bridgePort } = await startFakeBridge();
  t.after(() => {
    server.close();
  });
  const token = "test-token";
  writeDiscoveryFile(discoveryPath, deadPort, token);

  // Simulate the app finishing its restart: discovery is rewritten with the
  // new ephemeral port while the CLI is inside its first retry delay.
  const refresh = (async () => {
    await sleep(50);
    writeDiscoveryFile(discoveryPath, bridgePort, token);
  })();

  const client = await connectClient();
  await refresh;
  assert.equal(client.discovery.port, bridgePort);
  assert.equal(getAttempts(), 2);

  // The connection is usable end-to-end.
  await client.call("netcatty/getStatus", {});
  client.close();
  await sleep(20);
});

test("connectClient stops retrying and surfaces the original error when the port is unchanged", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-cli-connect-test-"));
  const discoveryPath = path.join(dir, "discovery.json");
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  setupDiscoveryEnv(t, discoveryPath);
  const getAttempts = countConnectAttempts(t);

  const deadPort = await getDeadPort();
  writeDiscoveryFile(discoveryPath, deadPort, "test-token");

  await assert.rejects(
    connectClient(),
    (err) => err?.code === "CONNECT_FAILED"
      && typeof err?.message === "string"
      && err.message.startsWith("Failed to connect to Netcatty TCP bridge: "),
  );

  // The re-read always yields the same port, so the retry loop must not
  // hammer the dead port with extra TCP attempts.
  assert.equal(getAttempts(), 1);
});

test("connectClient surfaces the original error when the discovery file disappears mid-retry", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-cli-connect-test-"));
  const discoveryPath = path.join(dir, "discovery.json");
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  setupDiscoveryEnv(t, discoveryPath);
  const getAttempts = countConnectAttempts(t);

  const deadPort = await getDeadPort();
  writeDiscoveryFile(discoveryPath, deadPort, "test-token");

  const refresh = (async () => {
    await sleep(50);
    fs.rmSync(discoveryPath, { force: true });
  })();

  await assert.rejects(
    connectClient(),
    (err) => err?.code === "CONNECT_FAILED"
      && typeof err?.message === "string"
      && err.message.startsWith("Failed to connect to Netcatty TCP bridge: "),
  );
  await refresh;

  assert.equal(getAttempts(), 1);
});
