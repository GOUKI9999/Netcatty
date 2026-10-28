"use strict";

/** Short, checkpointed recovery. Never executes commands or creates terminals. */
function createSessionRecoveryService(ctx = {}) {
  const incidents = new Map();
  const running = new Set();
  const now = ctx.now || Date.now;
  const sleep = ctx.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const pending = sessionId => ({ ok: true, sessionId, status: "pending", shellReady: false,
    nextAction: "session_recover", retryAfterMs: 1000 });

  async function recover(params = {}, executionContext = {}) {
    const id = params.sessionId;
    if (typeof id !== "string" || !id.trim()) return { ok: false, error: "sessionId is required." };
    if (!ctx.validate || !ctx.inspect || !ctx.reconnect) return { ok: false, error: "Scoped recovery is unavailable." };
    const validate = () => {
      const result = ctx.validate(params);
      if (result?.ok !== true) return result || { ok: false, error: "Recovery not authorized." };
      executionContext.beforeExecute?.();
      return null;
    };
    const denied = validate();
    if (denied) return denied;
    if (running.has(id)) return pending(id);
    running.add(id);
    const incident = incidents.get(id) || { startedAt: now(), attempts: 0, nextAt: 0 };
    const { startedAt } = incident;
    incidents.set(id, incident);
    const callDeadline = now() + 20000;
    try {
      while (now() < callDeadline) {
        const blocked = validate();
        if (blocked) return blocked;
        const state = await ctx.inspect(params, Math.min(2000, callDeadline - now()));
        const revoked = validate();
        if (revoked) return revoked;
        if (state?.ok !== true) return state || { ok: false, error: "Recovery state is unavailable." };
        if (state.stopped) return { ok: false, sessionId: id, status: "stopped", code: "RECOVERY_CANCELLED", error: "The user stopped this terminal connection. Do not reconnect automatically." };
        if (state.waitingForInput) return { ...state, sessionId: id, status: "needs_input", shellReady: false, nextAction: "user_input" };
        if (state.busy) return { ...state, sessionId: id, status: "busy", shellReady: false, nextAction: "inspect_job" };
        if (state.status === "connected") {
          // Transport truth has converged: the connection is restored and
          // this bounded budget observed no transport error. shellReady is
          // ADVISORY here, not a gate. Recovery never types or replays
          // anything into the PTY, so a false-ready cannot inject input —
          // the agent verifies with its next action before writing. The
          // harm of a false-ready (one extra inspect_shell step) is far
          // below the harm of a false-NOT-ready, which used to loop this
          // recovery forever on custom/colored prompts (starship, PowerShell
          // continuation) the readiness probe cannot parse, leaving agents
          // convinced the session was unusable.
          incidents.delete(id);
          const shellReady = state.shellReady === true ? true : state.shellReady === false ? false : null;
          return { ...state, sessionId: id, shellReady, status: "ready",
            nextAction: shellReady === true ? "continue_task" : "inspect_shell" };
        }
        if (now() - startedAt >= 120000) return { ok: false, sessionId: id, code: "RECOVERY_LIMIT", error: "Recovery elapsed budget exhausted. Inspect the blocked session and continue independent authorized work." };
        if (now() >= callDeadline) break;
        let waitMs = 1000;
        if (state.status === "disconnected" && !state.reconnecting) {
          if (!state.reconnectAllowed) return { ...state, sessionId: id, status: "unavailable", nextAction: "inspect_terminal" };
          if (incident.attempts >= 3) return { ok: false, sessionId: id, code: "RECONNECT_LIMIT", error: "Three recovery attempts exhausted without a restored connection." };
          if (incident.nextAt > now()) waitMs = incident.nextAt - now();
          else {
            const result = await ctx.reconnect(params, { ...executionContext, deadlineAt: Math.min(callDeadline, startedAt + 120000) });
            if (result?.started !== false && result?.code !== "RECONNECT_BACKOFF") {
              incident.attempts++;
              incident.nextAt = now() + (incident.attempts === 1 ? 2000 : 5000);
            }
            const cancelled = validate();
            if (cancelled) return cancelled;
            if (result?.ok === false) {
              if (result.code !== "RECONNECT_BACKOFF") return result;
              waitMs = Math.max(1000, result.retryAfterMs || 1000);
            }
          }
        } else if (!["connected", "connecting", "disconnected"].includes(state.status)) {
          return { ok: false, sessionId: id, error: "Unknown terminal recovery state; inspect before retrying." };
        }
        // Revalidate at least once a second, including during reconnect backoff.
        const waitUntil = Math.min(now() + waitMs, callDeadline, startedAt + 120000);
        while (now() < waitUntil) {
          await sleep(Math.min(1000, waitUntil - now()));
          const cancelled = validate();
          if (cancelled) return cancelled;
        }
      }
      // The bounded budget expired without a transport error or a user
      // cancellation. Recovery never writes to the PTY, so completing here
      // cannot inject input; the agent verifies with its next action.
      // Reporting an advisory ready with an unknown shell beats returning
      // pending, which used to trap agents in an endless session_recover
      // loop whenever the readiness probe could not confirm the prompt.
      return { ok: true, sessionId: id, status: "ready", shellReady: null,
        nextAction: "inspect_shell" };
    } finally {
      running.delete(id);
    }
  }
  return { recover, forget: id => incidents.delete(id) };
}

module.exports = { createSessionRecoveryService };
