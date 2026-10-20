"use strict";

const fs = require("node:fs");
const net = require("node:net");

const { getCliDiscoveryFilePath } = require("./discoveryPath.cjs");
const { CAPABILITY_SURFACES } = require("../capabilities/constants.cjs");
const { createNdjsonRpcClient } = require("../capabilities/rpcTransport.cjs");

function createError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function loadDiscovery() {
  const discoveryPath = getCliDiscoveryFilePath();
  let raw;
  try {
    raw = fs.readFileSync(discoveryPath, "utf8");
  } catch (err) {
    throw createError(
      "APP_NOT_RUNNING",
      `Netcatty discovery file is missing at ${discoveryPath}. `
      + "Either Netcatty is not running, or the discovery file was removed while Netcatty is still up; "
      + "Netcatty recreates it automatically within a few seconds — retry shortly, "
      + "or toggle the AI permission mode / restart Netcatty to regenerate it immediately. "
      + "Session data is not affected.",
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw createError(
      "DISCOVERY_INVALID",
      `Netcatty discovery file at ${discoveryPath} is invalid JSON.`,
    );
  }

  if (!parsed?.port || !parsed?.token) {
    throw createError(
      "DISCOVERY_INVALID",
      `Netcatty discovery file at ${discoveryPath} is missing required port/token fields.`,
    );
  }

  return parsed;
}

// Restart-window race (#3443): the TCP bridge listens on an ephemeral port
// (`server.listen(0, "127.0.0.1")` in electron/bridges/mcpServerBridge.cjs)
// and rewrites the discovery file on every app launch. A CLI that reads the
// discovery file while the app is restarting can connect to a port that is
// already dead and fail with CONNECT_FAILED until the chat is reopened.
// Retry a bounded number of times by re-reading the discovery file, so a
// fresh port/token written by the restarted app is picked up without user
// intervention. If the re-read returns the same port nothing changed, so
// don't hammer the dead port — surface the original error instead.
const CONNECT_RETRY_DELAYS_MS = [300, 900];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function establishConnection(discovery) {
  const socket = await new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: "127.0.0.1", port: discovery.port }, () => resolve(sock));
    sock.setEncoding("utf8");
    sock.once("error", (err) => {
      reject(createError("CONNECT_FAILED", `Failed to connect to Netcatty TCP bridge: ${err?.message || err}`));
    });
  });

  const client = createNdjsonRpcClient({
    socket,
    surface: CAPABILITY_SURFACES.BUILTIN,
    createError,
    messages: {
      connectionClosed: "Connection to Netcatty TCP bridge closed.",
      connectionClosedWhileCall: "Connection to Netcatty TCP bridge is closed.",
      connectionError: (error) => `Connection to Netcatty TCP bridge failed: ${error?.message || error}`,
      rpcTimeout: (method, timeoutMs) => (
        `Timed out waiting for Netcatty RPC response to "${method}" after ${timeoutMs}ms.`
      ),
      writeFailed: (method, error) => (
        `Failed to send Netcatty RPC "${method}": ${error?.message || error}`
      ),
    },
  });

  const authResult = await client.call("auth/verify", { token: discovery.token });
  if (!authResult?.ok) {
    throw createError("AUTH_FAILED", "Failed to authenticate to Netcatty TCP bridge.");
  }

  try {
    const statusResult = await client.call("netcatty/getStatus", {});
    client.ingestBridgeStatus(statusResult);
  } catch {
    // Keep the default RPC timeout when bridge status cannot be fetched.
  }

  return {
    discovery,
    async call(method, params) {
      return await client.call(method, params);
    },
    close() {
      client.close();
    },
  };
}

async function connectClient() {
  const discoveryPath = getCliDiscoveryFilePath();
  let discovery = loadDiscovery();
  let lastError = null;
  let attemptedPort = discovery.port;

  // Bounded retry: at most CONNECT_RETRY_DELAYS_MS.length extra attempts
  // (adds at most ~1.2s of latency in the worst case).
  for (let attempt = 0; attempt <= CONNECT_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      if (!discoveryPath) break;
      await sleep(CONNECT_RETRY_DELAYS_MS[attempt - 1]);
      let refreshed = null;
      try {
        refreshed = loadDiscovery();
      } catch {
        // The discovery file disappeared or became unreadable during the
        // restart; retrying cannot help, surface the connect error.
        break;
      }
      if (!refreshed?.port || refreshed.port === attemptedPort) break;
      discovery = refreshed;
    }

    attemptedPort = discovery.port;
    try {
      return await establishConnection(discovery);
    } catch (err) {
      lastError = err;
      // Only TCP connect failures are worth retrying; auth/RPC errors mean
      // the bridge accepted us and the discovery data is current.
      if (err?.code !== "CONNECT_FAILED") break;
    }
  }

  throw lastError;
}

module.exports = {
  connectClient,
  createError,
};
