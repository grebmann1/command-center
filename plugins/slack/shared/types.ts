/**
 * Shared Slack types — used by both the main capability (notification sender)
 * and the renderer panel (settings UI). Plain data only; safe to import from
 * either process.
 */

/** Slack notification configuration stored in extension storage. */
export interface SlackConfig {
  /** Incoming webhook URL (for simple notifications). */
  webhookUrl?: string;
  /** Bot token (for richer Web API notifications; optional alternative to webhook). */
  botToken?: string;
  /** Default channel (e.g. "#cctc-notifications"). */
  defaultChannel?: string;
  /** Which lifecycle events to notify on. */
  notifyOn: {
    /** Session transitions to "blocked" (needs user input). */
    sessionBlocked: boolean;
    /** Session exits (done/error). */
    sessionExit: boolean;
    /** Scheduled run completes. */
    scheduledComplete: boolean;
  };
  /** Debounce window (ms) — group rapid-fire events. */
  debounceMs: number;
}

/** Default config for a fresh install. */
export const DEFAULT_SLACK_CONFIG: SlackConfig = {
  notifyOn: {
    sessionBlocked: true,
    sessionExit: true,
    scheduledComplete: false
  },
  debounceMs: 5000
};

/** A pending notification (queued for debouncing). */
export interface PendingNotification {
  /** Stable key for deduplication (e.g. `"session:blocked:abc123"`). */
  key: string;
  /** Markdown message body. */
  text: string;
  /** Timestamp when it was queued. */
  queuedAt: number;
}
