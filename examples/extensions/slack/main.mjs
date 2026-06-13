const c = {
  notifyOn: {
    sessionBlocked: !0,
    sessionExit: !0,
    scheduledComplete: !1
  },
  debounceMs: 5e3
};
async function l(s, o, a, t) {
  if (o.webhookUrl)
    try {
      const e = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: a })
      }, r = await s(o.webhookUrl, e);
      return r.ok ? { ok: !0 } : (t(`Slack webhook failed: ${r.status} ${r.body}`), { ok: !1, error: `Webhook returned ${r.status}` });
    } catch (e) {
      const r = e instanceof Error ? e.message : String(e);
      return t(`Slack webhook error: ${r}`), { ok: !1, error: r };
    }
  if (o.botToken && o.defaultChannel)
    try {
      const e = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${o.botToken}`
        },
        body: JSON.stringify({
          channel: o.defaultChannel,
          text: a,
          unfurl_links: !1,
          unfurl_media: !1
        })
      }, r = await s("https://slack.com/api/chat.postMessage", e);
      if (!r.ok)
        return t(`Slack Web API HTTP error: ${r.status}`), { ok: !1, error: `HTTP ${r.status}` };
      let n;
      try {
        n = JSON.parse(r.body);
      } catch {
      }
      if ((n == null ? void 0 : n.ok) === !0)
        return { ok: !0 };
      const i = (n == null ? void 0 : n.error) ?? "API returned ok:false";
      return t(`Slack Web API error: ${i}`), { ok: !1, error: i };
    } catch (e) {
      const r = e instanceof Error ? e.message : String(e);
      return t(`Slack Web API error: ${r}`), { ok: !1, error: r };
    }
  return { ok: !1, error: "No webhook URL or bot token configured" };
}
const k = {
  id: "slack",
  setup(s) {
    const { log: o, storage: a } = s, t = s.fetch;
    if (!t)
      throw new Error("slack: ctx.fetch capability is unavailable; cannot reach Slack.");
    return {
      /**
       * Send a Slack notification. Called by the renderer when a lifecycle event fires.
       * Reads the config from storage, validates it, and POSTs to Slack.
       */
      async notify(e) {
        if (typeof e != "string" || !e.trim())
          return { ok: !1, error: "Empty message text" };
        const r = await a.get("config") ?? c;
        return l(t, r, e, o);
      },
      /**
       * Test the Slack connection by sending a ping message.
       * Used by the settings panel's "Test Connection" button.
       */
      async testConnection() {
        const e = await a.get("config") ?? c;
        return !e.webhookUrl && !e.botToken ? { ok: !1, error: "No webhook URL or bot token configured" } : l(
          t,
          e,
          ":wave: CCTC Slack extension test notification",
          o
        );
      }
    };
  }
};
export {
  k as default
};
