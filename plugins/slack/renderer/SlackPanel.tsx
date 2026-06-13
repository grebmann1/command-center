/**
 * Slack settings panel — configure outbound notifications + document the two
 * MCP-driven Slack agent schedules (mention triage + [agent] runner).
 *
 * Tier A: settings surface for the existing Slack agents (from template-store).
 * Tier B: automatic lifecycle notifications (session blocked/exit).
 */

import { useState, useEffect, useCallback } from 'react';
import type { ModuleHost } from '@cctc/extension-sdk/renderer';
import { type SlackConfig, DEFAULT_SLACK_CONFIG } from '../shared/types.js';

interface SlackPanelProps {
  host: ModuleHost;
}

export default function SlackPanel({ host }: SlackPanelProps) {
  const [config, setConfig] = useState<SlackConfig>(DEFAULT_SLACK_CONFIG);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Load config from storage on mount.
  useEffect(() => {
    host.storage.get<SlackConfig>('config').then((saved) => {
      if (saved) setConfig(saved);
    });
  }, [host]);

  // Save config to storage (debounced).
  const saveConfig = useCallback(
    (updated: SlackConfig) => {
      setConfig(updated);
      host.storage.set('config', updated);
    },
    [host]
  );

  // Test connection.
  const handleTest = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await host.call<{ ok: boolean; error?: string }>('testConnection');
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, error: String(err) });
    } finally {
      setIsTesting(false);
    }
  }, [host]);

  // Subscribe to lifecycle events and notify on matches.
  useEffect(() => {
    const handlers: Array<() => void> = [];

    // Session blocked (needs user input).
    if (config.notifyOn.sessionBlocked) {
      const off = host.on('session:agentStatus', ({ sessionId, state }) => {
        if (state === 'blocked') {
          const project = host.getActiveProject();
          const text = `⚠️ Session \`${sessionId.slice(0, 8)}\` needs your input${project ? ` in *${project.name}*` : ''}`;
          host.call('notify', text).catch((err) => console.error('Slack notify failed:', err));
        }
      });
      handlers.push(off);
    }

    // Session exit (done).
    if (config.notifyOn.sessionExit) {
      const off = host.on('session:exit', ({ sessionId, code }) => {
        const project = host.getActiveProject();
        const icon = code === 0 ? '✅' : '❌';
        const text = `${icon} Session \`${sessionId.slice(0, 8)}\` finished (exit ${code})${project ? ` in *${project.name}*` : ''}`;
        host.call('notify', text).catch((err) => console.error('Slack notify failed:', err));
      });
      handlers.push(off);
    }

    return () => handlers.forEach((off) => off());
  }, [host, config.notifyOn]);

  return (
    <div style={{ padding: '1rem', maxWidth: '700px' }}>
      <h2 style={{ marginBottom: '1rem' }}>Slack Integration</h2>

      {/* Tier A: reference to existing Slack agents */}
      <section style={{ marginBottom: '2rem' }}>
        <h3>MCP-Driven Slack Agents</h3>
        <p style={{ color: '#888', marginBottom: '1rem' }}>
          CCTC includes two builtin Slack agent schedules that use the Slack MCP tools:
        </p>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li>
            <strong>slack-mention-triage</strong> (every 30 min) — scans for @mentions, DMs, and
            thread replies; classifies them (action/fyi/noise); pushes a digest to your inbox.
          </li>
          <li>
            <strong>slack-agent-runner</strong> (every 15 min) — finds your messages starting with{' '}
            <code>[agent]</code>, runs the instruction in the project cwd, replies in-thread.
          </li>
        </ul>
        <p style={{ color: '#888', fontSize: '0.9rem' }}>
          These are configured in the <strong>Scheduler</strong> panel. To enable them, create a
          schedule from the <code>builtin:slack-mention-triage</code> or{' '}
          <code>builtin:slack-agent-runner</code> templates.
        </p>
      </section>

      {/* Tier B: automatic outbound notifications */}
      <section style={{ marginBottom: '2rem' }}>
        <h3>Automatic Lifecycle Notifications</h3>
        <p style={{ color: '#888', marginBottom: '1rem' }}>
          CCTC can automatically post to Slack when sessions need your attention or finish.
        </p>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            <strong>Webhook URL</strong> (easiest)
          </label>
          <input
            type="text"
            value={config.webhookUrl ?? ''}
            onChange={(e) => saveConfig({ ...config, webhookUrl: e.target.value || undefined })}
            placeholder="https://hooks.slack.com/services/..."
            style={{ width: '100%', padding: '0.5rem', fontFamily: 'monospace' }}
          />
          <small style={{ color: '#888' }}>
            Create an{' '}
            <a
              href="https://api.slack.com/messaging/webhooks"
              onClick={(e) => {
                e.preventDefault();
                host.openExternal('https://api.slack.com/messaging/webhooks');
              }}
              style={{ color: '#4A9EFF' }}
            >
              Incoming Webhook
            </a>{' '}
            in your Slack workspace.
          </small>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            <strong>Bot Token</strong> (alternative, for Web API)
          </label>
          <input
            type="password"
            value={config.botToken ?? ''}
            onChange={(e) => saveConfig({ ...config, botToken: e.target.value || undefined })}
            placeholder="xoxb-..."
            style={{ width: '100%', padding: '0.5rem', fontFamily: 'monospace' }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            <strong>Default Channel</strong> (for bot token)
          </label>
          <input
            type="text"
            value={config.defaultChannel ?? ''}
            onChange={(e) =>
              saveConfig({ ...config, defaultChannel: e.target.value || undefined })
            }
            placeholder="#cctc-notifications"
            style={{ width: '100%', padding: '0.5rem', fontFamily: 'monospace' }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <strong>Notify on:</strong>
          <div style={{ marginTop: '0.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              <input
                type="checkbox"
                checked={config.notifyOn.sessionBlocked}
                onChange={(e) =>
                  saveConfig({
                    ...config,
                    notifyOn: { ...config.notifyOn, sessionBlocked: e.target.checked }
                  })
                }
              />{' '}
              Session blocked (needs your input)
            </label>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              <input
                type="checkbox"
                checked={config.notifyOn.sessionExit}
                onChange={(e) =>
                  saveConfig({
                    ...config,
                    notifyOn: { ...config.notifyOn, sessionExit: e.target.checked }
                  })
                }
              />{' '}
              Session finished (exit)
            </label>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              <input
                type="checkbox"
                checked={config.notifyOn.scheduledComplete}
                onChange={(e) =>
                  saveConfig({
                    ...config,
                    notifyOn: { ...config.notifyOn, scheduledComplete: e.target.checked }
                  })
                }
              />{' '}
              Scheduled run completes
            </label>
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            <strong>Debounce (ms)</strong>
          </label>
          <input
            type="number"
            value={config.debounceMs}
            onChange={(e) => saveConfig({ ...config, debounceMs: Number(e.target.value) || 5000 })}
            min="0"
            step="1000"
            style={{ width: '150px', padding: '0.5rem' }}
          />
          <small style={{ color: '#888', marginLeft: '0.5rem' }}>
            Group rapid-fire notifications
          </small>
        </div>

        <button
          onClick={handleTest}
          disabled={isTesting || (!config.webhookUrl && !config.botToken)}
          style={{
            padding: '0.5rem 1rem',
            background: isTesting ? '#666' : '#4A9EFF',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: isTesting ? 'not-allowed' : 'pointer'
          }}
        >
          {isTesting ? 'Testing...' : 'Test Connection'}
        </button>

        {testResult && (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.75rem',
              background: testResult.ok ? '#2A4A2A' : '#4A2A2A',
              borderRadius: '4px'
            }}
          >
            {testResult.ok ? '✅ Test notification sent!' : `❌ ${testResult.error}`}
          </div>
        )}
      </section>

      <section style={{ marginTop: '2rem', padding: '1rem', background: '#1a1a1a', borderRadius: '4px' }}>
        <h4 style={{ marginBottom: '0.5rem' }}>About Tier C (Live Bot)</h4>
        <p style={{ color: '#888', fontSize: '0.9rem' }}>
          A live Slack bot (e.g. <code>run &lt;prompt&gt;</code> launches a session, thread-per-session,
          interactive buttons) requires a persistent socket-mode listener — which needs a daemon. For
          that capability, consider bridging to Claude Unleashed, which already has a full Slack bot.
        </p>
      </section>
    </div>
  );
}
