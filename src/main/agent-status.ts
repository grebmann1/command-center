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
 *  - the Notification-hook overlay, which is the ONLY signal that can tell
 *    "idle at the prompt" apart from "waiting on the user" (a permission
 *    prompt or an interactive question). The OSC title shows the same `✳`
 *    glyph in both cases, so without the hook a blocked agent reads as idle.
 *  - a small resolver that fuses the two sources, and debounce/coalescing so a
 *    burst of detections collapses to at most one emit per session per window.
 *
 * It deliberately does NOT touch `TerminalSession`: status streams over its own
 * `onAgentStatus` channel into a dedicated renderer store slice, so a status
 * tick never rebuilds the `terminals` map (the render-storm guard the arch
 * council made binding — BC 7/10).
 *
 * Source fusion (see {@link resolve}): an active spinner (`working`) always
 * wins — it means the agent is producing output again, so any stale "blocked"
 * overlay is dropped. Otherwise the Notification overlay (`blocked`) wins over
 * the OSC `idle`/`unknown`, because while blocked Claude keeps emitting the
 * idle glyph. Screen-scan (LAS-07) is a later, additive OSC-like input.
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

/**
 * Strip the leading agent-status glyph (a braille spinner U+2800–U+28FF, or the
 * `✳` U+2733 idle marker) and surrounding whitespace from an OSC title, leaving
 * just the human-readable summary text Claude writes after it (e.g.
 * `✳ Fix the login bug` → `Fix the login bug`). Returns the trimmed remainder,
 * or '' when the title is only a glyph / empty. Pure; exported for tests.
 */
export function stripTitleGlyph(title: string): string {
  const trimmed = title.trimStart();
  const ch = trimmed.codePointAt(0);
  if (ch !== undefined && ((ch >= 0x2800 && ch <= 0x28ff) || ch === 0x2733)) {
    // Drop the glyph (a single code point, which may be >1 UTF-16 unit).
    return trimmed.slice(String.fromCodePoint(ch).length).trim();
  }
  return trimmed.trim();
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
  /**
   * Latest state derived from the PTY stream (OSC title / screen-scan). This is
   * the moment-to-moment signal: spinner → `working`, `✳` → `idle`.
   */
  osc: AgentState;
  /**
   * Whether the Notification hook says this session is waiting on the user.
   * Sticky: set true on a `permission_prompt`/`idle_prompt` notification and
   * only cleared when the agent visibly resumes (`working`) or the turn is
   * answered (UserPromptSubmit / Stop). The OSC `idle` glyph can't clear it —
   * Claude shows that same glyph the whole time it's blocked.
   */
  blocked: boolean;
  timer: NodeJS.Timeout | null;
  /**
   * The last task-summary title we emitted on the `title` event for this
   * session, so a repeated idle title (Claude re-emits the same `✳ summary`
   * on every idle frame) doesn't fire a redundant rename. Undefined until the
   * first idle title is seen.
   */
  emittedTitle?: string;
}

/**
 * Fuse the per-session inputs into the single state we surface.
 *  - `working` always wins: the spinner means the agent is producing output, so
 *    any stale blocked overlay is moot (and `clearBlocked` will have dropped it).
 *  - otherwise a `blocked` overlay wins over the OSC reading, because Claude
 *    keeps emitting the `idle` glyph while it waits on the user.
 *  - else fall through to whatever the OSC stream last said.
 */
function resolve(entry: Entry): AgentState {
  if (entry.osc === 'working') return 'working';
  if (entry.blocked) return 'blocked';
  return entry.osc;
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

  private entry(sessionId: string): Entry {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = { emitted: 'unknown', osc: 'unknown', blocked: false, timer: null };
      this.entries.set(sessionId, entry);
    }
    return entry;
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
    // When idle, the text after the `✳` glyph is Claude's auto-generated task
    // summary (stable for the duration of idle). Surface it as a `title` event
    // so the renderer can self-label the tab. We only adopt the IDLE title —
    // the working spinner's text is a transient verb ("Cooking…") that would
    // flicker the tab. Emit only on change (Claude re-sends the same idle title
    // each frame).
    if (state === 'idle') {
      const summary = stripTitleGlyph(title);
      if (summary) {
        const entry = this.entry(sessionId);
        if (entry.emittedTitle !== summary) {
          entry.emittedTitle = summary;
          this.emit('title', sessionId, summary);
        }
      }
    }
    this.report(sessionId, state);
  }

  /**
   * Record an OSC/screen-scan derived state. A `working` reading also implies
   * the agent has resumed, so it clears any sticky blocked overlay.
   */
  report(sessionId: string, state: AgentState): void {
    const entry = this.entry(sessionId);
    entry.osc = state;
    if (state === 'working') entry.blocked = false;
    this.schedule(sessionId, entry);
  }

  /**
   * The Notification hook fired — the agent is waiting on the user (permission
   * prompt or an interactive question). Sets the sticky blocked overlay.
   */
  markBlocked(sessionId: string): void {
    const entry = this.entry(sessionId);
    entry.blocked = true;
    this.schedule(sessionId, entry);
  }

  /**
   * The user answered (UserPromptSubmit) or the turn ended (Stop) — the agent
   * is no longer waiting on input. Drops the blocked overlay; the resolved
   * state falls back to the latest OSC reading.
   */
  clearBlocked(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry || !entry.blocked) return;
    entry.blocked = false;
    this.schedule(sessionId, entry);
  }

  /** Schedule a debounced flush when the resolved state would change. */
  private schedule(sessionId: string, entry: Entry): void {
    if (entry.timer !== null) return; // a flush is already scheduled
    if (resolve(entry) === entry.emitted) return; // nothing would change
    entry.timer = setTimeout(() => this.flush(sessionId), EMIT_DEBOUNCE_MS);
  }

  private flush(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.timer = null;
    const next = resolve(entry);
    if (next === entry.emitted) return;
    entry.emitted = next;
    this.emit('status', sessionId, entry.emitted);
  }

  /** Forget a session (call on pty exit). Clears any pending timer. */
  remove(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry?.timer) clearTimeout(entry.timer);
    this.entries.delete(sessionId);
  }
}
