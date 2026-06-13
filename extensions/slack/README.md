# Slack Extension

Slack integration for Claude Code Terminal Center — automatic lifecycle notifications + formalized agent schedules.

## Features

### Tier A: MCP-Driven Slack Agents (Formalized)
References the two builtin Slack agent schedules from the core scheduler:
- **slack-mention-triage** (every 30 min) — scans for @mentions, DMs, thread replies; classifies (action/fyi/noise); pushes a digest to the inbox
- **slack-agent-runner** (every 15 min) — finds your messages starting with `[agent]`, runs the instruction in project cwd, replies in-thread

These are configured via the core Scheduler panel using the builtin templates.

### Tier B: Automatic Lifecycle Notifications (NEW)
CCTC automatically posts to Slack when:
- A session transitions to "blocked" (needs your input)
- A session exits (done/error)
- A scheduled run completes (optional)

Configure via:
- **Webhook URL** (easiest): create an [Incoming Webhook](https://api.slack.com/messaging/webhooks) in your Slack workspace
- **Bot Token** (alternative): use Slack Web API with a bot token + channel

Notifications are debounced (5s default) to avoid spam.

## Development

```bash
# Build the extension
npm run build

# Package into examples/ and ~/.cc-center/extensions/
npm run package

# Typecheck
npm run typecheck
```

## Architecture

- **Main module** (`slack-main.ts`): outbound Slack notifier via brokered `ctx.fetch` (permission-gated to `slack.com`, `hooks.slack.com`, `api.slack.com`)
- **Renderer** (`SlackPanel.tsx`): settings UI + lifecycle event subscriptions (`host.on('session:agentStatus')`, `host.on('session:exit')`)
- **Permissions**: `net` (for fetch), `storage` (config), `inbox:push` (future)

## Tier C (Deferred)
A live Slack bot (socket-mode listener, `run <prompt>` launches sessions, thread-per-session, interactive buttons) requires a persistent daemon — consider bridging to Claude Unleashed instead of rebuilding.
