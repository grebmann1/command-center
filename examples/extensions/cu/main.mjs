var T = Object.defineProperty;
var S = (t, n, o) => n in t ? T(t, n, { enumerable: !0, configurable: !0, writable: !0, value: o }) : t[n] = o;
var k = (t, n, o) => S(t, typeof n != "symbol" ? n + "" : n, o);
const j = "claude-unleashed";
class E extends Error {
  constructor() {
    super(...arguments);
    k(this, "kind", "cu-unavailable");
  }
}
async function l(t, n, o, e = 3e4) {
  try {
    return await t({ bin: j, args: n, timeoutMs: e });
  } catch (s) {
    const u = s instanceof Error ? s.message : String(s);
    throw o(`claude-unleashed spawn failed: ${u}`), new E(
      "Claude Unleashed CLI not found — install `claude-unleashed` and ensure it is on PATH."
    );
  }
}
function c(t) {
  const n = t == null ? void 0 : t.trim();
  if (!n) return null;
  try {
    return JSON.parse(n);
  } catch {
    const o = n.match(/(\{[\s\S]*\}|\[[\s\S]*\])\s*$/);
    if (o)
      try {
        return JSON.parse(o[1]);
      } catch {
      }
    return null;
  }
}
function r(t, n) {
  for (const o of n) {
    const e = t[o];
    if (e != null) return e;
  }
}
function d(t) {
  if (typeof t == "number" && Number.isFinite(t)) return t;
  if (typeof t == "string" && t.trim() && Number.isFinite(Number(t))) return Number(t);
}
function a(t) {
  return typeof t == "string" ? t : t == null ? void 0 : String(t);
}
function M(t) {
  return {
    id: a(r(t, ["id", "sessionId", "session_id"])) ?? "",
    shortName: a(r(t, ["shortName", "short_name", "name"])),
    repoPath: a(r(t, ["repoPath", "repo_path", "repo", "cwd"])),
    status: a(r(t, ["status", "state"])),
    turns: d(r(t, ["turns", "turnCount", "turn_count"])),
    costUsd: d(r(t, ["costUsd", "cost_usd", "cost"])),
    profile: a(r(t, ["profile", "profileName", "profile_name"])),
    model: a(r(t, ["model", "modelId", "model_id"])),
    title: a(r(t, ["title"])),
    startedAt: a(r(t, ["startedAt", "started_at", "createdAt", "created_at"]))
  };
}
async function p(t, n, o, e = 3e4) {
  const { stdout: s, stderr: u, code: i } = await l(t, n, o, e), m = i === 0;
  return m || o(`action failed [${n.join(" ")}]: code ${i} ${u || s}`), { ok: m, code: i, message: (u || s || "").trim() || void 0 };
}
function y(t) {
  const n = [];
  return t != null && t.repo && n.push("--repo", t.repo), t != null && t.status && n.push("--status", t.status), t != null && t.profile && n.push("--profile", t.profile), t != null && t.olderThan && n.push("--older-than", t.olderThan), n;
}
function g(t, ...n) {
  let o = t;
  if (t && !Array.isArray(t) && typeof t == "object") {
    const e = t;
    o = n.map((s) => e[s]).find(Array.isArray) ?? [];
  }
  return (Array.isArray(o) ? o : []).filter(
    (e) => !!e && typeof e == "object"
  );
}
function h(t) {
  if (Array.isArray(t)) return t.map((n) => String(n)).filter(Boolean);
  if (typeof t == "string" && t.trim()) return t.split(",").map((n) => n.trim()).filter(Boolean);
}
function b(t) {
  if (typeof t == "boolean") return t;
  if (typeof t == "string") {
    const n = t.trim().toLowerCase();
    if (n === "true" || n === "enabled" || n === "yes") return !0;
    if (n === "false" || n === "disabled" || n === "no") return !1;
  }
}
const U = {
  id: "cu",
  setup(t) {
    const { log: n } = t, o = t.exec;
    if (!o)
      throw new Error("cu: brokered exec capability is unavailable; cannot run the claude-unleashed CLI.");
    return {
      /** Daemon liveness. The renderer reads this to drive the daemon-down UI. */
      async daemonStatus() {
        const { stdout: e } = await l(o, ["daemon", "status", "--json"], n), s = c(e);
        if (!s || typeof s.running != "boolean")
          throw new E(
            "Claude Unleashed CLI responded unexpectedly — is `claude-unleashed` the right binary on PATH?"
          );
        return {
          running: s.running,
          pid: d(s.pid),
          socket: a(s.socket),
          uptime: d(s.uptime)
        };
      },
      /** All sessions in the fleet. */
      async listSessions() {
        const { stdout: e } = await l(o, ["sessions", "ls", "--json"], n), s = c(e);
        return (Array.isArray(s) ? s : s && typeof s == "object" ? s.sessions ?? s.items ?? [] : []).filter((i) => !!i && typeof i == "object").map(M).filter((i) => i.id);
      },
      /** One session by id or short name. */
      async getSession(e) {
        if (typeof e != "string" || !e) return null;
        const { stdout: s } = await l(o, ["sessions", "get", e, "--json"], n), u = c(s);
        return u && typeof u == "object" ? M(u) : null;
      },
      /** Resource vitals (pid/rss/cpu) for one session. */
      async vitals(e) {
        if (typeof e != "string" || !e) return {};
        const { stdout: s } = await l(o, ["sessions", "vitals", e, "--json"], n), u = c(s) ?? {};
        return {
          pid: d(r(u, ["pid"])),
          rss: d(r(u, ["rss", "rssBytes", "memory"])),
          cpu: d(r(u, ["cpu", "cpuPercent", "cpu_percent"]))
        };
      },
      /** Markdown post-mortem for a completed session (NOT --json). */
      async postMortem(e) {
        if (typeof e != "string" || !e) return { markdown: "" };
        const { stdout: s, stderr: u, code: i } = await l(o, ["sessions", "post-mortem", e], n);
        return i !== 0 && !s.trim() ? { markdown: `_No post-mortem available._

${(u || "").trim()}` } : { markdown: s.trim() };
      },
      /** Fleet rollup. Recognized fields + a `raw` escape hatch. */
      async dashboard() {
        const { stdout: e } = await l(o, ["dashboard", "--json"], n), s = c(e) ?? {};
        return {
          totalSessions: d(r(s, ["totalSessions", "total", "sessions"])),
          running: d(r(s, ["running", "active"])),
          completed: d(r(s, ["completed"])),
          failed: d(r(s, ["failed"])),
          paused: d(r(s, ["paused"])),
          totalCostUsd: d(r(s, ["totalCostUsd", "costUsd", "cost"])),
          raw: s
        };
      },
      /** Weekly cost/turns summary. */
      async report() {
        const { stdout: e } = await l(o, ["report", "--json"], n), s = c(e) ?? {};
        return {
          totalCostUsd: d(r(s, ["totalCostUsd", "costUsd", "cost"])),
          totalTurns: d(r(s, ["totalTurns", "turns"])),
          sessions: d(r(s, ["sessions", "sessionCount"])),
          raw: s
        };
      },
      // --- Per-session mutating actions (prose output → ok on code 0) ---------
      async pause(e) {
        if (!e) throw new Error("Missing session id");
        return p(o, ["sessions", "pause", e], n);
      },
      async resume(e) {
        if (!e) throw new Error("Missing session id");
        return p(o, ["sessions", "resume", e], n);
      },
      async unstick(e) {
        if (!e) throw new Error("Missing session id");
        return p(o, ["sessions", "unstick", e], n);
      },
      async kill(e) {
        if (!e) throw new Error("Missing session id");
        return p(o, ["sessions", "kill", e], n);
      },
      // --- Fleet-wide actions -------------------------------------------------
      async pauseAll(e) {
        return p(o, ["sessions", "pause-all", ...y(e)], n);
      },
      async resumeAll(e) {
        return p(o, ["sessions", "resume-all", ...y(e)], n);
      },
      async killAll(e) {
        return p(o, ["sessions", "kill-all", ...y(e)], n);
      },
      // --- Daemon lifecycle ---------------------------------------------------
      async startDaemon() {
        return p(o, ["daemon", "start"], n, 45e3);
      },
      async stopDaemon() {
        return p(o, ["daemon", "stop"], n, 45e3);
      },
      async restartDaemon() {
        return p(o, ["daemon", "restart"], n, 45e3);
      },
      /**
       * Launch a new session. `cu run` emits JSON by DEFAULT and ERRORS if given
       * `--json`, so we never pass it and parse the plain stdout. Args go through
       * the broker without a shell, so the prompt is a single argv element — no
       * quoting or injection concern.
       */
      async run(e) {
        if (!(e != null && e.repoPath)) throw new Error("Missing repo path");
        if (!(e != null && e.prompt)) throw new Error("Missing prompt");
        const s = ["run", "--repo", e.repoPath, "--prompt", e.prompt];
        e.model && s.push("--model", e.model), e.profile && s.push("--profile", e.profile), e.agent && s.push("--agent", e.agent), typeof e.maxTurns == "number" && s.push("--max-turns", String(e.maxTurns)), typeof e.maxBudgetUsd == "number" && s.push("--max-budget-usd", String(e.maxBudgetUsd)), e.permissionMode && s.push("--permission-mode", e.permissionMode), e.allowedTools && s.push("--allowed-tools", e.allowedTools);
        const { stdout: u, stderr: i, code: m } = await l(o, s, n);
        if (m !== 0) {
          const w = (i || u || "cu run failed").trim();
          throw n(`run failed: ${w}`), new Error(w);
        }
        const f = c(u);
        return {
          ok: !0,
          sessionId: a(r(f ?? {}, ["id", "sessionId", "session_id"])),
          shortName: a(r(f ?? {}, ["shortName", "short_name", "name"])),
          raw: u.trim() || void 0
        };
      },
      // --- Catalogs: profiles / agents / agent-groups -------------------------
      async listProfiles() {
        const { stdout: e } = await l(o, ["profiles", "ls", "--json"], n);
        return g(c(e), "profiles", "items").map((s) => ({
          name: a(r(s, ["name"])) ?? "",
          description: a(r(s, ["description", "desc"])),
          model: a(r(s, ["model"])),
          permissionMode: a(r(s, ["permissionMode", "permission_mode"])),
          maxTurns: d(r(s, ["maxTurns", "max_turns"])),
          maxBudgetUsd: d(r(s, ["maxBudgetUsd", "max_budget_usd"])),
          raw: s
        })).filter((s) => s.name);
      },
      async listAgents(e) {
        const s = ["agents", "ls", "--json"];
        e && s.push("--repo", e);
        const { stdout: u } = await l(o, s, n);
        return g(c(u), "agents", "items").map((i) => ({
          name: a(r(i, ["name"])) ?? "",
          description: a(r(i, ["description", "desc"])),
          archetype: a(r(i, ["archetype"])),
          model: a(r(i, ["model"])),
          allowedTools: h(r(i, ["allowedTools", "allowed_tools", "tools"])),
          scope: a(r(i, ["scope"])),
          raw: i
        })).filter((i) => i.name);
      },
      async listAgentGroups() {
        const { stdout: e } = await l(o, ["agent-groups", "ls", "--json"], n);
        return g(c(e), "agentGroups", "agent_groups", "groups", "items").map((s) => ({
          name: a(r(s, ["name"])) ?? "",
          description: a(r(s, ["description", "desc"])),
          members: h(r(s, ["members", "agents"])),
          coordinator: a(r(s, ["coordinator"])),
          raw: s
        })).filter((s) => s.name);
      },
      // --- Catalogs: workflows ------------------------------------------------
      async listWorkflows() {
        const { stdout: e } = await l(o, ["workflow", "ls", "--json"], n);
        return g(c(e), "workflows", "items").map((s) => ({
          name: a(r(s, ["name"])) ?? "",
          description: a(r(s, ["description", "desc"])),
          nodeCount: d(r(s, ["nodeCount", "node_count", "nodes"])),
          scope: a(r(s, ["scope"])),
          raw: s
        })).filter((s) => s.name);
      },
      async listWorkflowRuns() {
        const { stdout: e } = await l(o, ["workflow", "runs", "--json"], n);
        return g(c(e), "runs", "items").map((s) => ({
          token: a(r(s, ["token", "runId", "run_id", "id"])) ?? "",
          workflow: a(r(s, ["workflow", "name"])),
          status: a(r(s, ["status", "state"])),
          startedAt: a(r(s, ["startedAt", "started_at", "createdAt"])),
          raw: s
        })).filter((s) => s.token);
      },
      /** Kick off a workflow. Like `run`, emits JSON by default — no `--json`. */
      async runWorkflow(e, s) {
        if (!e) throw new Error("Missing workflow name");
        if (!s) throw new Error("Missing repo path");
        const { stdout: u, stderr: i, code: m } = await l(
          o,
          ["workflow", "run", e, "--repo", s],
          n
        );
        if (m !== 0) {
          const w = (i || u || "cu workflow run failed").trim();
          throw n(`workflow run failed: ${w}`), new Error(w);
        }
        const f = c(u);
        return {
          ok: !0,
          sessionId: a(r(f ?? {}, ["token", "runId", "run_id", "id"])),
          shortName: a(r(f ?? {}, ["name", "workflow"])),
          raw: u.trim() || void 0
        };
      },
      // --- Catalogs: schedules + GUS-CDC subscriptions ------------------------
      async listSchedules() {
        const { stdout: e } = await l(o, ["schedules", "ls", "--json"], n);
        return g(c(e), "schedules", "items").map((s) => ({
          name: a(r(s, ["name"])) ?? "",
          kind: a(r(s, ["kind"])),
          cron: a(r(s, ["cron", "cronExpr", "cron_expr"])),
          enabled: b(r(s, ["enabled"])),
          agent: a(r(s, ["agent", "agentName"])),
          agentGroup: a(r(s, ["agentGroup", "agent_group"])),
          target: a(r(s, ["target", "repo", "workflow"])),
          nextRun: a(r(s, ["nextRun", "next_run", "next"])),
          lastFailed: b(r(s, ["lastFailed", "last_failed", "failing"])),
          raw: s
        })).filter((s) => s.name);
      },
      async scheduleEnable(e) {
        if (!e) throw new Error("Missing schedule name");
        return p(o, ["schedules", "enable", e], n);
      },
      async scheduleDisable(e) {
        if (!e) throw new Error("Missing schedule name");
        return p(o, ["schedules", "disable", e], n);
      },
      async scheduleRunNow(e) {
        if (!e) throw new Error("Missing schedule name");
        return p(o, ["schedules", "run-now", e, "--json"], n);
      },
      async listSubscriptions() {
        const { stdout: e } = await l(
          o,
          ["gus-cdc", "subscriptions", "ls", "--json"],
          n
        );
        return g(c(e), "subscriptions", "items").map((s) => ({
          name: a(r(s, ["name"])) ?? "",
          targetType: a(r(s, ["targetType", "target_type"])),
          changeTypes: h(r(s, ["changeTypes", "change_types", "changeType"])),
          fields: h(r(s, ["fields", "field"])),
          enabled: b(r(s, ["enabled"])),
          raw: s
        })).filter((s) => s.name);
      },
      // --- Detail view (the `show` subcommands) -------------------------------
      /**
       * Dump one catalog item's full definition for the detail modal. Each kind
       * maps to its `cu <kind> show <name>` — which emits YAML for the rich
       * objects (profiles/agents/workflows include a systemPrompt and node DAG
       * that read best as YAML), so we return the raw text AND a best-effort
       * JSON parse (some `show`s emit JSON). The renderer shows the text body and
       * uses the parsed object when present.
       *
       * `kind` is one of: profile | agent | agent-group | workflow | schedule |
       * subscription. `repoPath` (agents only) scopes the lookup to the merged
       * user+repo catalog.
       */
      async showDetail(e, s, u) {
        if (!s) throw new Error("Missing name");
        const m = {
          profile: ["profiles", "show", s],
          agent: ["agents", "show", s],
          "agent-group": ["agent-groups", "show", s],
          workflow: ["workflow", "show", s],
          schedule: ["schedules", "show", s],
          subscription: ["gus-cdc", "subscriptions", "show", s]
        }[e];
        if (!m) throw new Error(`Unknown detail kind: ${e}`);
        e === "agent" && u && m.push("--repo", u);
        const { stdout: f, stderr: w, code: A } = await l(o, m, n);
        if (A !== 0 && !f.trim()) {
          const _ = (w || `cu ${m.join(" ")} failed`).trim();
          throw n(`show failed: ${_}`), new Error(_);
        }
        return { text: f.trim(), parsed: c(f) };
      },
      // --- Approvals ----------------------------------------------------------
      async approvalsList() {
        const { stdout: e } = await l(o, ["approvals", "ls", "--json"], n), s = c(e);
        return (Array.isArray(s) ? s : s && typeof s == "object" ? s.approvals ?? [] : []).filter((i) => !!i && typeof i == "object").map((i) => ({
          id: a(r(i, ["id", "approvalId"])) ?? "",
          sessionId: a(r(i, ["sessionId", "session_id"])),
          tool: a(r(i, ["tool", "toolName"])),
          summary: a(r(i, ["summary", "description", "reason"])),
          createdAt: a(r(i, ["createdAt", "created_at"]))
        })).filter((i) => i.id);
      },
      async approve(e, s) {
        if (!e) throw new Error("Missing approval id");
        return p(o, ["approvals", "approve", e, ...s ? [s] : []], n);
      },
      async deny(e, s) {
        if (!e) throw new Error("Missing approval id");
        return p(o, ["approvals", "deny", e, ...s ? [s] : []], n);
      }
    };
  }
};
export {
  U as default
};
