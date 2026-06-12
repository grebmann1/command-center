/**
 * Sanitize `launchSession` extraArgs against a denylist of flags that would let
 * an extension launch an over-privileged or attacker-shaped Claude agent in the
 * user's repo (design §1c). Shared (no Node/Electron/React) so the renderer
 * `ModuleHost` gate and any future main-side gate apply the SAME rule.
 *
 * The denied flags either disable the permission prompt, inject an
 * attacker-controlled tool/MCP config, or override the system prompt — each is a
 * way to turn a benign-looking launch into an auto-approving or hijacked agent.
 * Matching is on the flag token, including its `--flag=value` form.
 */

/** Flags an extension may never pass via `launchSession`. */
export const DENIED_LAUNCH_FLAGS: readonly string[] = [
  '--dangerously-skip-permissions',
  '--mcp-config',
  '--permission-mode',
  '--append-system-prompt',
  '--system-prompt',
  '--allowedTools',
  '--allowed-tools',
  '--disallowedTools',
  '--disallowed-tools',
  '--add-dir'
];

export interface SanitizeResult {
  /** The args with denied flags (and their attached values) removed. */
  args: string[];
  /** The denied flag tokens that were stripped (for logging / a warning toast). */
  removed: string[];
}

/**
 * Strip denied flags from an extension-supplied extraArgs vector. Handles both
 * `--flag value` (drops the flag and its following value) and `--flag=value`
 * (drops the single token) forms. Unknown/benign flags pass through unchanged.
 */
export function sanitizeExtraArgs(extraArgs: readonly string[] | undefined): SanitizeResult {
  if (!extraArgs || extraArgs.length === 0) return { args: [], removed: [] };
  const denied = new Set(DENIED_LAUNCH_FLAGS);
  const args: string[] = [];
  const removed: string[] = [];
  for (let i = 0; i < extraArgs.length; i++) {
    const tok = extraArgs[i];
    const eq = tok.indexOf('=');
    const flag = eq >= 0 ? tok.slice(0, eq) : tok;
    if (denied.has(flag)) {
      removed.push(flag);
      // `--flag value` form: also skip the following value token (if any and not
      // itself a flag). `--flag=value` form: nothing extra to skip.
      if (eq < 0 && i + 1 < extraArgs.length && !extraArgs[i + 1].startsWith('-')) {
        i++;
      }
      continue;
    }
    args.push(tok);
  }
  return { args, removed };
}
