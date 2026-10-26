# Scoped disconnected-session reconnect

## Objective and scope

Continue the workspace session continuity objective after merged PR #3885. Expose explicit reconnect for an existing, authorized, disconnected session without creating a tab, moving it, granting ownership, or replaying commands. Reuse the terminal's existing reconnect handler. Connected, authenticating, unmounted and already-reconnecting terminals must not be restarted by this operation.

## Plan

1. Add failing lifecycle, permission and renderer-registry tests.
2. Add a catalog/RPC/CLI operation using existing approval and scope enforcement.
3. Bound agent requests per session incident: three attempts, 2/5 second backoff and a 120 second starting window; only an observed connected state resets the incident. No timers queue delayed input or recovery.
4. Update bundled operator guidance, run focused regressions, lint and build, then submit a follow-up PR against current upstream.

## Status

- Planning: complete. Base: upstream main `0256e7471`; original checkout changes preserved.
- Tests: first seven new cases failed before implementation; 314 focused regressions now pass, including real MCP transport startup, root bridge scope/cancellation, permission dispatch, renderer lifecycle gates and existing terminal view regressions. CLI adapter suite: 16/16 pass after the additional required-session case. Targeted ESLint passes.
- Implementation: complete. Catalog/generated tools, CLI, progressive MCP `sessions` category, scoped main-process service and renderer reconnect handler are connected. Lost replies consume budget; explicit non-dispatch replies do not. Live connected snapshots and explicit tab closure clear incident state.
- Build: `npm run build` passed; final rebuild after the Vault queue bypass also passed (1m 46s, existing large-chunk warnings). Additional final renderer bridge suite: 92/92 passed; targeted lint passed again.
- Submission: [PR #3935](https://github.com/binaricat/Netcatty/pull/3935), branch `feat/scoped-session-reconnect-20261026`. Local validation complete; upstream CI/review pending.

## Findings and limits

- Expanded tests caught the missing progressive MCP category: the new tool initially prevented MCP startup. Added `sessions` to the loader and reran the real transport test successfully.
- Existing UI auto-reconnect remains independent; limits here apply to agent-dispatched attempts during the main-process lifetime. No second automatic retry loop or deferred reconnect queue is introduced.
- No real user SSH connection was disconnected for fault injection. End-to-end desktop sleep/wake and SSH network fault tests remain manual acceptance cases; automated checks exercise the existing runtime dispatch boundary without affecting user sessions.
- The production build does not replace the installed application; the new CLI command requires a running build containing this capability.

## Acceptance

- Original tab, workspace and session ID retained.
- Out-of-scope, cancelled, observer and revoked requests cannot reconnect.
- Concurrent requests do not create duplicate connections; no request waits for a future terminal mount.
- Authentication and active reconnect remain under the existing UI lifecycle.
- Reconnect acknowledgement never claims shell readiness or command completion.
- Retry exhaustion is retained across chat turns; no session/tab storm.

Restarting a connected/hung transport, moving sessions and remote process termination remain later increments. A reconnect does not prove an old process has stopped.
