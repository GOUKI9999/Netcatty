const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseSecureCrtCommandLine,
  redactSecureCrtCommandLinePasswords,
} = require("./secureCrtCommandLine.cjs");

test("parseSecureCrtCommandLine accepts 4A-style /SSH2 launch", () => {
  assert.deepEqual(
    parseSecureCrtCommandLine([
      String.raw`C:\Program Files\Netcatty\Netcatty.exe`,
      "/SSH2",
      "/L",
      "alice",
      "/P",
      "2222",
      "/PASSWORD",
      "s3cret",
      "10.0.0.8",
    ]),
    {
      protocol: "ssh",
      url: "ssh://alice:s3cret@10.0.0.8:2222",
      hostname: "10.0.0.8",
      username: "alice",
      password: "s3cret",
      port: 2222,
    },
  );
});

test("parseSecureCrtCommandLine accepts PAM-style /T /N /SSH2 line", () => {
  const parsed = parseSecureCrtCommandLine([
    "Netcatty.exe",
    "/T",
    "/N",
    "Device",
    "/SSH2",
    "/L",
    "root",
    "192.168.10.2",
    "/P",
    "22",
  ]);
  assert.equal(parsed?.url, "ssh://root@192.168.10.2:22");
  assert.equal(parsed?.username, "root");
  assert.equal(parsed?.password, undefined);
  assert.equal(parsed?.port, 22);
});

test("parseSecureCrtCommandLine accepts case-insensitive flags and user@host positional", () => {
  const parsed = parseSecureCrtCommandLine([
    "Netcatty.exe",
    "/ssh2",
    "/password",
    "pw",
    "bob@host.example.com",
  ]);
  assert.equal(parsed?.url, "ssh://bob:pw@host.example.com");
  assert.equal(parsed?.username, "bob");
  assert.equal(parsed?.hostname, "host.example.com");
});

test("parseSecureCrtCommandLine accepts /TELNET", () => {
  const parsed = parseSecureCrtCommandLine([
    "Netcatty.exe",
    "/TELNET",
    "old.example.com",
    "/P",
    "2323",
  ]);
  assert.equal(parsed?.protocol, "telnet");
  assert.equal(parsed?.url, "telnet://old.example.com:2323");
});

test("parseSecureCrtCommandLine consumes and ignores auth, identity and session values", () => {
  const parsed = parseSecureCrtCommandLine([
    "Netcatty.exe",
    "/SSH2",
    "/AUTH",
    "keyboard-interactive",
    "/I",
    String.raw`C:\keys\id_rsa`,
    "/S",
    "Production",
    "/L",
    "ops",
    "/PASSWORD",
    "hunter2",
    "bastion.example.com",
  ]);
  assert.equal(parsed?.url, "ssh://ops:hunter2@bastion.example.com");
});

test("parseSecureCrtCommandLine rejects unsupported protocols and missing values", () => {
  assert.equal(parseSecureCrtCommandLine(["Netcatty.exe", "/SERIAL", "com1"]), null);
  assert.equal(parseSecureCrtCommandLine(["Netcatty.exe", "/SSH2", "/L"]), null);
  assert.equal(parseSecureCrtCommandLine(["Netcatty.exe", "/SSH2", "/P", "99999"]), null);
  assert.equal(parseSecureCrtCommandLine(["Netcatty.exe", "/SSH2", "/PASSWORD", ""]), null);
  assert.equal(parseSecureCrtCommandLine(["Netcatty.exe", "-ssh", "user@host", "-pw", "x"]), null);
});

test("redactSecureCrtCommandLinePasswords masks /PASSWORD and /PASSPHRASE values", () => {
  const argv = ["Netcatty.exe", "/SSH2", "/PASSWORD", "s3cret", "/PASSPHRASE", "phrase", "host"];
  redactSecureCrtCommandLinePasswords(argv);
  assert.deepEqual(argv, ["Netcatty.exe", "/SSH2", "/PASSWORD", "******", "/PASSPHRASE", "******", "host"]);
});
