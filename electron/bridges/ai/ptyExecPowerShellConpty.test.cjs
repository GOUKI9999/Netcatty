const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { buildWrappedCommand } = require('./ptyExecHelpers.cjs');
const { extractTrailingIdlePrompt } = require('./shellUtils.cjs');

// Opt in on a Windows machine with node-pty available. These tests launch only
// private no-profile shells; they never send input to a user's terminal.
const enabled = process.platform === 'win32' && process.env.NETCATTY_POWERSHELL_CONPTY_TEST === '1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('PowerShell wrapper submits with one Enter and no trailing line-feed', () => {
  const command = buildWrappedCommand("Write-Output 'OK'", 'powershell', '__NCMCP_ENDING__');
  assert.ok(command.endsWith('\r'));
  assert.ok(!command.endsWith('\r\n'));
});

for (const executable of ['powershell.exe', 'pwsh.exe']) {
  test(`two agent jobs leave ${executable} ready without an extra Enter`, {
    skip: !enabled,
    timeout: 20000,
  }, async t => {
    let shell;
    try {
      shell = execFileSync('where.exe', [executable], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    } catch {
      t.skip(`${executable} is not installed`);
      return;
    }
    const pty = require('node-pty');
    const terminal = pty.spawn(shell, ['-NoLogo', '-NoProfile'], {
      name: 'xterm-256color', cols: 160, rows: 35, env: process.env,
    });
    let output = '';
    let exited = false;
    terminal.onExit(() => { exited = true; });
    terminal.onData(data => {
      output += data;
      if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R');
    });
    const waitForPrompt = async (attempts = 100) => {
      for (let i = 0; i < attempts && !extractTrailingIdlePrompt(output); i++) await sleep(100);
      return extractTrailingIdlePrompt(output);
    };
    try {
      assert.ok(await waitForPrompt(), 'initial idle prompt');
      for (const word of ['FIRST_OK', 'SECOND_OK']) {
        output = '';
        const marker = `__NCMCP_${word}__`;
        terminal.write(buildWrappedCommand(`Write-Output '${word}'`, 'powershell', marker));
        for (let i = 0; i < 80 && !output.includes(`${marker}_E:0\r\n`); i++) await sleep(100);
        assert.ok(output.includes(`${marker}_E:0\r\n`), 'successful command completion marker');
        assert.ok(output.includes(`\r\n${word}\r\n`), 'real command output, not the input echo');
        // An end marker can precede the next prompt. Let ConPTY deliver the
        // remaining bytes, including any accidental LF / continuation prompt.
        await sleep(250);
        assert.ok(await waitForPrompt(20), 'completed job must return to an idle prompt');
      }
    } finally {
      terminal.write('\x03exit\r');
      for (let i = 0; i < 10 && !exited; i++) await sleep(100);
      if (!exited) terminal.kill();
    }
  });
}
