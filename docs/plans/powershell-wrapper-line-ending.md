# PowerShell wrapper line ending

## Goal and diagnosis

Issue #4036: the first agent command succeeds, but the terminal then displays
`PS ...>` followed by `>>`. A subsequent command fails with `SHELL_NOT_READY`.

Independent no-profile ConPTY tests reproduced this with Windows PowerShell
and PowerShell 7. The production wrapper's CRLF submits the command with CR,
then leaves a blank PSReadLine continuation with LF. A single CR returns to
the idle prompt after the same command.

## Change

Terminate the PowerShell wrapper with CR only. Keep the readiness guard strict:
never count `>>` as idle or automatically submit a user's continuation buffer.
No changes to POSIX, fish, cmd, scope, authorization or cancellation rules.

## Validation

Native regression tests failed before the fix for both shells, and passed after
the fix, including two consecutive wrapped commands per shell. Enable them on
Windows with `NETCATTY_POWERSHELL_CONPTY_TEST=1` and run
`node --test electron/bridges/ai/ptyExecPowerShellConpty.test.cjs`.
Other platforms skip only those native tests; the line-ending contract is portable.
A readiness regression verifies blank and nonblank continuations send zero bytes.

The native harness owns private no-profile PTYs and never operates user terminals.
Windows OpenSSH / PowerShell on non-Windows hosts remain manual acceptance cases.
