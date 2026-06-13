/**
 * Slack module — main process side.
 *
 * Provides outbound notification capabilities to Slack via webhook or Web API,
 * using the brokered `ctx.fetch` capability (gated by `net` permission +
 * `egressAllowlist: ['slack.com', 'hooks.slack.com', 'api.slack.com']`).
 *
 * Capabilities exposed to the renderer via `ModuleHost.call`:
 *   - notify(text: string) → { ok: boolean; error?: string }
 *   - testConnection()     → { ok: boolean; error?: string }
 *
 * The renderer subscribes to session lifecycle events (`host.on('session:agentStatus')`,
 * `host.on('session:exit')`) and calls `notify` on matches, so this main module
 * never directly observes core state — it's a pure fetch wrapper.
 */

import type { MainModule, MainModuleContext, BrokeredFetchInit } from '@cctc/extension-sdk/main';
import { type SlackConfig, DEFAULT_SLACK_CONFIG } from '../shared/types.js';

/** The brokered fetch capability (from `MainModuleContext.fetch`). */
type Fetch = NonNullable<MainModuleContext['fetch']>;

/**
 * Send a Slack notification via webhook or Web API.
 * Prefers webhook (simpler); falls back to Web API if only a bot token is configured.
 */
async function sendSlackNotification(
  fetch: Fetch,
  config: SlackConfig,
  text: string,
  log: MainModuleContext['log']
): Promise<{ ok: boolean; error?: string }> {
  // Prefer webhook (simpler, no channel resolution).
  if (config.webhookUrl) {
    try {
      const init: BrokeredFetchInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      };
      const res = await fetch(config.webhookUrl, init);
      if (res.ok) {
        return { ok: true };
      }
      log(`Slack webhook failed: ${res.status} ${res.body}`);
      return { ok: false, error: `Webhook returned ${res.status}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Slack webhook error: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  // Fallback: Web API with bot token.
  if (config.botToken && config.defaultChannel) {
    try {
      const init: BrokeredFetchInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.botToken}`
        },
        body: JSON.stringify({
          channel: config.defaultChannel,
          text,
          unfurl_links: false,
          unfurl_media: false
        })
      };
      const res = await fetch('https://slack.com/api/chat.postMessage', init);
      if (!res.ok) {
        log(`Slack Web API HTTP error: ${res.status}`);
        return { ok: false, error: `HTTP ${res.status}` };
      }
      let parsed: { ok?: boolean; error?: string } | undefined;
      try {
        parsed = JSON.parse(res.body);
      } catch {
        // Ignore parse errors; check res.ok.
      }
      if (parsed?.ok === true) {
        return { ok: true };
      }
      const errMsg = parsed?.error ?? 'API returned ok:false';
      log(`Slack Web API error: ${errMsg}`);
      return { ok: false, error: errMsg };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Slack Web API error: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  // No valid config.
  return { ok: false, error: 'No webhook URL or bot token configured' };
}

export const slackMainModule: MainModule = {
  id: 'slack',
  setup(ctx) {
    const { log, storage } = ctx;
    const fetch = ctx.fetch;
    if (!fetch) {
      throw new Error('slack: ctx.fetch capability is unavailable; cannot reach Slack.');
    }

    return {
      /**
       * Send a Slack notification. Called by the renderer when a lifecycle event fires.
       * Reads the config from storage, validates it, and POSTs to Slack.
       */
      async notify(text: string): Promise<{ ok: boolean; error?: string }> {
        if (typeof text !== 'string' || !text.trim()) {
          return { ok: false, error: 'Empty message text' };
        }
        const config = (await storage.get<SlackConfig>('config')) ?? DEFAULT_SLACK_CONFIG;
        return sendSlackNotification(fetch, config, text, log);
      },

      /**
       * Test the Slack connection by sending a ping message.
       * Used by the settings panel's "Test Connection" button.
       */
      async testConnection(): Promise<{ ok: boolean; error?: string }> {
        const config = (await storage.get<SlackConfig>('config')) ?? DEFAULT_SLACK_CONFIG;
        if (!config.webhookUrl && !config.botToken) {
          return { ok: false, error: 'No webhook URL or bot token configured' };
        }
        return sendSlackNotification(
          fetch,
          config,
          ':wave: CCTC Slack extension test notification',
          log
        );
      }
    };
  }
};
