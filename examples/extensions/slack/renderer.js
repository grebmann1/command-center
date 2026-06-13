let hostReact = null;
const GLOBAL_KEY = "__CCTC_HOST_REACT__";
function setHostReact(react) {
  hostReact = react;
}
function getHostReact() {
  if (hostReact) return hostReact;
  const fromGlobal = globalThis[GLOBAL_KEY];
  if (fromGlobal) {
    hostReact = fromGlobal;
    return hostReact;
  }
  throw new Error(
    "slack extension: host React unavailable — the host must set globalThis." + GLOBAL_KEY + " before import, or call activate({ React })."
  );
}
const Fragment = Symbol.for("gus-ext.jsx.Fragment");
function build(type, props, key) {
  const React = getHostReact();
  const realType = type === Fragment ? React.Fragment : type;
  const { children, ...rest } = props ?? {};
  const restWithKey = rest;
  if (Array.isArray(children)) {
    return React.createElement(realType, restWithKey, ...children);
  }
  if (children === void 0) {
    return React.createElement(realType, restWithKey);
  }
  return React.createElement(realType, restWithKey, children);
}
function jsx(type, props, key) {
  return build(type, props);
}
function jsxs(type, props, key) {
  return build(type, props);
}
const useState = (...a) => getHostReact().useState(...a);
const useEffect = (...a) => getHostReact().useEffect(...a);
const useCallback = (...a) => getHostReact().useCallback(...a);
new Proxy(
  {},
  {
    get(_t, prop) {
      return getHostReact()[prop];
    },
    has(_t, prop) {
      return prop in getHostReact();
    }
  }
);
const DEFAULT_SLACK_CONFIG = {
  notifyOn: {
    sessionBlocked: true,
    sessionExit: true,
    scheduledComplete: false
  },
  debounceMs: 5e3
};
function SlackPanel({ host }) {
  const [config, setConfig] = useState(DEFAULT_SLACK_CONFIG);
  const [testResult, setTestResult] = useState(null);
  const [isTesting, setIsTesting] = useState(false);
  useEffect(() => {
    host.storage.get("config").then((saved) => {
      if (saved) setConfig(saved);
    });
  }, [host]);
  const saveConfig = useCallback(
    (updated) => {
      setConfig(updated);
      host.storage.set("config", updated);
    },
    [host]
  );
  const handleTest = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await host.call("testConnection");
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, error: String(err) });
    } finally {
      setIsTesting(false);
    }
  }, [host]);
  useEffect(() => {
    const handlers = [];
    if (config.notifyOn.sessionBlocked) {
      const off = host.on("session:agentStatus", ({ sessionId, state }) => {
        if (state === "blocked") {
          const project = host.getActiveProject();
          const text = `⚠️ Session \`${sessionId.slice(0, 8)}\` needs your input${project ? ` in *${project.name}*` : ""}`;
          host.call("notify", text).catch((err) => console.error("Slack notify failed:", err));
        }
      });
      handlers.push(off);
    }
    if (config.notifyOn.sessionExit) {
      const off = host.on("session:exit", ({ sessionId, code }) => {
        const project = host.getActiveProject();
        const icon = code === 0 ? "✅" : "❌";
        const text = `${icon} Session \`${sessionId.slice(0, 8)}\` finished (exit ${code})${project ? ` in *${project.name}*` : ""}`;
        host.call("notify", text).catch((err) => console.error("Slack notify failed:", err));
      });
      handlers.push(off);
    }
    return () => handlers.forEach((off) => off());
  }, [host, config.notifyOn]);
  return /* @__PURE__ */ jsxs("div", { style: { padding: "1rem", maxWidth: "700px" }, children: [
    /* @__PURE__ */ jsx("h2", { style: { marginBottom: "1rem" }, children: "Slack Integration" }),
    /* @__PURE__ */ jsxs("section", { style: { marginBottom: "2rem" }, children: [
      /* @__PURE__ */ jsx("h3", { children: "MCP-Driven Slack Agents" }),
      /* @__PURE__ */ jsx("p", { style: { color: "#888", marginBottom: "1rem" }, children: "CCTC includes two builtin Slack agent schedules that use the Slack MCP tools:" }),
      /* @__PURE__ */ jsxs("ul", { style: { marginLeft: "1.5rem", marginBottom: "1rem" }, children: [
        /* @__PURE__ */ jsxs("li", { children: [
          /* @__PURE__ */ jsx("strong", { children: "slack-mention-triage" }),
          " (every 30 min) — scans for @mentions, DMs, and thread replies; classifies them (action/fyi/noise); pushes a digest to your inbox."
        ] }),
        /* @__PURE__ */ jsxs("li", { children: [
          /* @__PURE__ */ jsx("strong", { children: "slack-agent-runner" }),
          " (every 15 min) — finds your messages starting with",
          " ",
          /* @__PURE__ */ jsx("code", { children: "[agent]" }),
          ", runs the instruction in the project cwd, replies in-thread."
        ] })
      ] }),
      /* @__PURE__ */ jsxs("p", { style: { color: "#888", fontSize: "0.9rem" }, children: [
        "These are configured in the ",
        /* @__PURE__ */ jsx("strong", { children: "Scheduler" }),
        " panel. To enable them, create a schedule from the ",
        /* @__PURE__ */ jsx("code", { children: "builtin:slack-mention-triage" }),
        " or",
        " ",
        /* @__PURE__ */ jsx("code", { children: "builtin:slack-agent-runner" }),
        " templates."
      ] })
    ] }),
    /* @__PURE__ */ jsxs("section", { style: { marginBottom: "2rem" }, children: [
      /* @__PURE__ */ jsx("h3", { children: "Automatic Lifecycle Notifications" }),
      /* @__PURE__ */ jsx("p", { style: { color: "#888", marginBottom: "1rem" }, children: "CCTC can automatically post to Slack when sessions need your attention or finish." }),
      /* @__PURE__ */ jsxs("div", { style: { marginBottom: "1rem" }, children: [
        /* @__PURE__ */ jsxs("label", { style: { display: "block", marginBottom: "0.5rem" }, children: [
          /* @__PURE__ */ jsx("strong", { children: "Webhook URL" }),
          " (easiest)"
        ] }),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "text",
            value: config.webhookUrl ?? "",
            onChange: (e) => saveConfig({ ...config, webhookUrl: e.target.value || void 0 }),
            placeholder: "https://hooks.slack.com/services/...",
            style: { width: "100%", padding: "0.5rem", fontFamily: "monospace" }
          }
        ),
        /* @__PURE__ */ jsxs("small", { style: { color: "#888" }, children: [
          "Create an",
          " ",
          /* @__PURE__ */ jsx(
            "a",
            {
              href: "https://api.slack.com/messaging/webhooks",
              onClick: (e) => {
                e.preventDefault();
                host.openExternal("https://api.slack.com/messaging/webhooks");
              },
              style: { color: "#4A9EFF" },
              children: "Incoming Webhook"
            }
          ),
          " ",
          "in your Slack workspace."
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { marginBottom: "1rem" }, children: [
        /* @__PURE__ */ jsxs("label", { style: { display: "block", marginBottom: "0.5rem" }, children: [
          /* @__PURE__ */ jsx("strong", { children: "Bot Token" }),
          " (alternative, for Web API)"
        ] }),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "password",
            value: config.botToken ?? "",
            onChange: (e) => saveConfig({ ...config, botToken: e.target.value || void 0 }),
            placeholder: "xoxb-...",
            style: { width: "100%", padding: "0.5rem", fontFamily: "monospace" }
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { marginBottom: "1rem" }, children: [
        /* @__PURE__ */ jsxs("label", { style: { display: "block", marginBottom: "0.5rem" }, children: [
          /* @__PURE__ */ jsx("strong", { children: "Default Channel" }),
          " (for bot token)"
        ] }),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "text",
            value: config.defaultChannel ?? "",
            onChange: (e) => saveConfig({ ...config, defaultChannel: e.target.value || void 0 }),
            placeholder: "#cctc-notifications",
            style: { width: "100%", padding: "0.5rem", fontFamily: "monospace" }
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { marginBottom: "1rem" }, children: [
        /* @__PURE__ */ jsx("strong", { children: "Notify on:" }),
        /* @__PURE__ */ jsxs("div", { style: { marginTop: "0.5rem" }, children: [
          /* @__PURE__ */ jsxs("label", { style: { display: "block", marginBottom: "0.5rem" }, children: [
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "checkbox",
                checked: config.notifyOn.sessionBlocked,
                onChange: (e) => saveConfig({
                  ...config,
                  notifyOn: { ...config.notifyOn, sessionBlocked: e.target.checked }
                })
              }
            ),
            " ",
            "Session blocked (needs your input)"
          ] }),
          /* @__PURE__ */ jsxs("label", { style: { display: "block", marginBottom: "0.5rem" }, children: [
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "checkbox",
                checked: config.notifyOn.sessionExit,
                onChange: (e) => saveConfig({
                  ...config,
                  notifyOn: { ...config.notifyOn, sessionExit: e.target.checked }
                })
              }
            ),
            " ",
            "Session finished (exit)"
          ] }),
          /* @__PURE__ */ jsxs("label", { style: { display: "block", marginBottom: "0.5rem" }, children: [
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "checkbox",
                checked: config.notifyOn.scheduledComplete,
                onChange: (e) => saveConfig({
                  ...config,
                  notifyOn: { ...config.notifyOn, scheduledComplete: e.target.checked }
                })
              }
            ),
            " ",
            "Scheduled run completes"
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { marginBottom: "1rem" }, children: [
        /* @__PURE__ */ jsx("label", { style: { display: "block", marginBottom: "0.5rem" }, children: /* @__PURE__ */ jsx("strong", { children: "Debounce (ms)" }) }),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "number",
            value: config.debounceMs,
            onChange: (e) => saveConfig({ ...config, debounceMs: Number(e.target.value) || 5e3 }),
            min: "0",
            step: "1000",
            style: { width: "150px", padding: "0.5rem" }
          }
        ),
        /* @__PURE__ */ jsx("small", { style: { color: "#888", marginLeft: "0.5rem" }, children: "Group rapid-fire notifications" })
      ] }),
      /* @__PURE__ */ jsx(
        "button",
        {
          onClick: handleTest,
          disabled: isTesting || !config.webhookUrl && !config.botToken,
          style: {
            padding: "0.5rem 1rem",
            background: isTesting ? "#666" : "#4A9EFF",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: isTesting ? "not-allowed" : "pointer"
          },
          children: isTesting ? "Testing..." : "Test Connection"
        }
      ),
      testResult && /* @__PURE__ */ jsx(
        "div",
        {
          style: {
            marginTop: "1rem",
            padding: "0.75rem",
            background: testResult.ok ? "#2A4A2A" : "#4A2A2A",
            borderRadius: "4px"
          },
          children: testResult.ok ? "✅ Test notification sent!" : `❌ ${testResult.error}`
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("section", { style: { marginTop: "2rem", padding: "1rem", background: "#1a1a1a", borderRadius: "4px" }, children: [
      /* @__PURE__ */ jsx("h4", { style: { marginBottom: "0.5rem" }, children: "About Tier C (Live Bot)" }),
      /* @__PURE__ */ jsxs("p", { style: { color: "#888", fontSize: "0.9rem" }, children: [
        "A live Slack bot (e.g. ",
        /* @__PURE__ */ jsx("code", { children: "run <prompt>" }),
        " launches a session, thread-per-session, interactive buttons) requires a persistent socket-mode listener — which needs a daemon. For that capability, consider bridging to Claude Unleashed, which already has a full Slack bot."
      ] })
    ] })
  ] });
}
const entry = {
  activate({ React }) {
    setHostReact(React);
    return {
      panel: SlackPanel
      // No commands or navBadge in v1.
    };
  }
};
export {
  entry as default
};
