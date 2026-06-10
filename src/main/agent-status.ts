/**
 * Agent-status tracker — the main-process source of truth for live agent state
 * (working / blocked / done / idle) per session.
 *
 * This is the LAS-05 + LAS-07b slice of the Live Agent Status Awareness plan
 * (`docs/live-agent-status-plan.md`). It owns:
 *
 *  - the per-session current {@link AgentState},
 *  - the OSC-title fast-path detector (the cheapest, highest-signal detector;
 *    parsed straight from the raw PTY byte stream, so it works for hidden /
 *    unfocused tabs too — something herdr cannot do since it reads the
 *    *rendered* title),
 *  - debounce/coalescing so a burst of detections collapses to at most one
 *    emit per session per window.
 *
 * It deliberately does NOT touch `TerminalSession`: status streams over its own
 * `onAgentStatus` channel into a dedicated renderer store slice, so a status
 * tick never rebuilds the `terminals` map (the render-storm guard the arch
 * council made binding — BC 7/10).
 *
 * Screen-scan (LAS-07) and lifecycle hooks (LAS-04/09) are later, additive
 * inputs: they will call {@link AgentStatusTracker.report} with their own
 * derived state and the resolver here will fuse them. For now the OSC title is
 * the only producer, which is enough to light a real dot.
 */

import { EventEmitter } from 'node:events';
import type { AgentState } from '../shared/types.js';

/** Debounce window: collapse a burst of detections into one emit per session.
 *  Spinner frames change ~10 Hz; we don't want to emit at that rate. */
const EMIT_DEBOUNCE_MS = 250;

/**
 * Classify an OSC title string into an agent state, or `null` when the title
 * carries no agent signal (so we leave the current state untouched).
 *
 * Mirrors the high-priority rules in herdr's `claude.toml`:
 *  - a leading braille glyph (U+2800–U+28FF) is Claude's "working" spinner,
 *  - a leading `✳` (U+2733) is Claude's idle/done marker.
 *
 * Anything else (a cwd-style title, a plain shell title) returns `null`.
 */
export function classifyOscTitle(title: string): AgentState | null {
  // The spinner/marker is the FIRST non-space glyph of the title. Claude emits
  // e.g. "⠹ Cooking…" while working and "✳ project" when idle.
  const ch = title.trimStart().codePointAt(0);
  if (ch === undefined) return null;
  if (ch >= 0x2800 && ch <= 0x28ff) return 'working'; // braille spinner
  if (ch === 0x2733) return 'idle'; // ✳ heavy asterisk
  return null;
}

const OSC_TITLE_RE =
  // OSC 0 (icon+title) or 2 (title), terminated by BEL (\x07) or ST (\x1b\\).
  /\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

/**
 * Extract the LAST OSC 0/2 title found in a PTY data chunk, or `null` if the
 * chunk sets no title. We only care about the most recent title in the chunk —
 * intermediate spinner frames within one chunk are superseded by the last.
 */
export function extractLastOscTitle(chunk: string): string | null {
  let match: RegExpExecArray | null;
  let last: string | null = null;
  OSC_TITLE_RE.lastIndex = 0;
  while ((match = OSC_TITLE_RE.exec(chunk)) !== null) {
    last = match[1];
  }
  return last;
}

interface Entry {
  /** Last state we actually emitted to listeners. */
  emitted: AgentState;
  /** Latest state a detector derived, awaiting debounce flush. */
  pending: AgentState;
  timer: NodeJS.Timeout | null;
}

/**
 * Tracks and debounces per-session agent state and emits `status` events.
 *
 * Events:
 *  - `status` (sessionId: string, state: AgentState) — debounced, only on change.
 */
export class AgentStatusTracker extends EventEmitter {
  private entries = new Map<string, Entry>();

  /** Current debounced state for a session (defaults to `unknown`). */
  get(sessionId: string): AgentState {
    return this.entries.get(sessionId)?.emitted ?? 'unknown';
  }

  /**
   * Feed a raw PTY data chunk through the OSC-title detector. Called from the
   * pty `data` event. Cheap: a regex over the chunk, only acts when the chunk
   * actually sets a title with an agent signal.
   */
  observeData(sessionId: string, chunk: string): void {
    const title = extractLastOscTitle(chunk);
    if (title === null) return;
    const state = classifyOscTitle(title);
    if (state === null) return;
    this.report(sessionId, state);
  }

  /**
   * Record a detector's derived state for a session and schedule a debounced
   * emit. Idempotent within a window: repeated identical states reset nothing
   * once already emitted. This is the single entry point other detectors
   * (screen-scan, hooks) will also call.
   */
  report(sessionId: string, state: AgentState): void {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = { emitted: 'unknown', pending: state, timer: null };
      this.entries.set(sessionId, entry);
    } else {
      entry.pending = state;
    }
    // Already showing this state and nothing else pending → nothing to do.
    if (entry.timer === null && entry.emitted === state) return;
    if (entry.timer !== null) return; // a flush is already scheduled
    entry.timer = setTimeout(() => this.flush(sessionId), EMIT_DEBOUNCE_MS);
  }

  private flush(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.timer = null;
    if (entry.pending === entry.emitted) return;
    entry.emitted = entry.pending;
    this.emit('status', sessionId, entry.emitted);
  }

  /** Forget a session (call on pty exit). Clears any pending timer. */
  remove(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry?.timer) clearTimeout(entry.timer);
    this.entries.delete(sessionId);
  }
}
