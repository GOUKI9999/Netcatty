const {
  hostCandidateScore,
  isElectronNoiseArg,
  parseHostSpec,
  parsePort,
  toDeepLinkUrl,
} = require("./puttyCommandLine.cjs");

const SSH_PROTOCOL = "ssh";
const TELNET_PROTOCOL = "telnet";

// SecureCRT-style protocol switches, e.g. `/SSH2 /L user /P 22 /PASSWORD pass
// host` (case-insensitive). 4A / PAM bastion launchers that let the operator
// pick a "SecureCRT" client emit exactly this shape, so Netcatty accepts it
// and funnels the result through the same ssh:// deep-link queue as PuTTY-style
// argv (#3390).
const PROTOCOL_FLAGS = new Map([
  ["/ssh", SSH_PROTOCOL],
  ["/ssh1", SSH_PROTOCOL],
  ["/ssh2", SSH_PROTOCOL],
  ["/telnet", TELNET_PROTOCOL],
]);

// Protocol switches Netcatty cannot map to a connection; bail out instead of
// silently connecting over a different transport.
const UNSUPPORTED_PROTOCOL_FLAGS = new Set([
  "/serial",
  "/rlogin",
  "/tapi",
]);

// Switches whose next argv token is a value. Most are accepted but ignored:
// Netcatty has no SecureCRT session database, identity file, auth-method or
// logging concept, so a 4A line that carries them still connects via the host.
const VALUE_FLAGS = new Set([
  "/l", // login username
  "/p", // port
  "/password",
  // Consumed and ignored:
  "/auth", // keyboard-interactive | password | publickey | gssapi | tacacs
  "/i", // identity (private key) file path
  "/passphrase",
  "/s", // saved SecureCRT session name
  "/n", // tab name
  "/log",
  "/logappend",
  "/firewall",
  "/fwfirewall",
  "/proxy",
]);

const PORT_FLAGS = new Set(["/p"]);
const USERNAME_FLAGS = new Set(["/l"]);
const PASSWORD_FLAGS = new Set(["/password"]);
const IGNORED_VALUE_FLAGS = new Set([
  "/auth", "/i", "/passphrase", "/s", "/n",
  "/log", "/logappend", "/firewall", "/fwfirewall", "/proxy",
]);
// Standalone switches (no separate value token).
const SKIP_FLAGS = new Set([
  "/t", // open in a tab (optional value stays unparsed; host comes last)
  "/new",
  "/x", "/c", "/v", "/a", "/z",
]);

const PASSWORD_REDACT_FLAGS = new Set(["/password", "/passphrase"]);

function normalizeFlag(arg) {
  return typeof arg === "string" ? arg.toLowerCase() : "";
}

function hasSecureCrtLaunchSignal(argv) {
  if (!Array.isArray(argv)) return false;
  return argv.some((arg) => {
    const flag = normalizeFlag(arg);
    return PROTOCOL_FLAGS.has(flag) || PASSWORD_REDACT_FLAGS.has(flag);
  });
}

function parseSecureCrtCommandLine(argv) {
  if (!Array.isArray(argv) || !hasSecureCrtLaunchSignal(argv)) return null;

  let protocol = SSH_PROTOCOL;
  let username;
  let password;
  let port;
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (typeof arg !== "string" || !arg) continue;
    const flag = normalizeFlag(arg);

    if (UNSUPPORTED_PROTOCOL_FLAGS.has(flag)) return null;

    const protocolFromFlag = PROTOCOL_FLAGS.get(flag);
    if (protocolFromFlag) {
      protocol = protocolFromFlag;
      continue;
    }

    if (SKIP_FLAGS.has(flag)) continue;

    if (VALUE_FLAGS.has(flag)) {
      const value = argv[index + 1];
      if (typeof value !== "string") return null;
      index += 1;
      if (PORT_FLAGS.has(flag)) {
        const parsedPort = parsePort(value);
        if (parsedPort === null) return null;
        port = parsedPort;
        continue;
      }
      if (USERNAME_FLAGS.has(flag)) {
        const nextUser = value.trim();
        if (!nextUser) return null;
        username = nextUser;
        continue;
      }
      if (PASSWORD_FLAGS.has(flag)) {
        if (value === "") return null;
        password = value;
        continue;
      }
      if (!IGNORED_VALUE_FLAGS.has(flag) || !value.trim()) return null;
      continue;
    }

    if (isElectronNoiseArg(arg, index, argv)) continue;

    const spec = parseHostSpec(arg);
    if (spec) positionals.push(spec);
  }

  if (positionals.length === 0) return null;

  const hostSpec = positionals.reduce((best, candidate) => (
    hostCandidateScore(candidate) > hostCandidateScore(best) ? candidate : best
  ));

  const resolvedUsername = (username || hostSpec.username || "").trim() || undefined;
  const resolvedPort = port ?? hostSpec.port;
  const hostname = hostSpec.hostname;
  if (!hostname) return null;

  const url = toDeepLinkUrl({
    protocol,
    username: resolvedUsername,
    password,
    hostname,
    port: resolvedPort,
  });

  return {
    protocol,
    url,
    hostname,
    ...(resolvedUsername ? { username: resolvedUsername } : {}),
    ...(password !== undefined ? { password } : {}),
    ...(resolvedPort ? { port: resolvedPort } : {}),
  };
}

function redactSecureCrtCommandLinePasswords(argv) {
  if (!Array.isArray(argv)) return argv;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = normalizeFlag(argv[index]);
    if (!PASSWORD_REDACT_FLAGS.has(flag)) continue;
    const next = argv[index + 1];
    if (typeof next !== "string") continue;
    argv[index + 1] = "*".repeat(Math.min(next.length, 8)) || "********";
  }
  return argv;
}

module.exports = {
  parseSecureCrtCommandLine,
  redactSecureCrtCommandLinePasswords,
};
