/**
 * Pure runtime helpers for extensions (`@cctc/extension-sdk/helpers`). No
 * React, no Node, no core dependency — safe to import from either process.
 */

/**
 * Unwrap the case where an agent has wrapped its entire body in a single
 * triple-backtick fence — sometimes with NESTED inner fences. Nested
 * fences are invalid markdown (the parser closes the outer block at the
 * first inner fence, and the rest renders inconsistently), so a body that
 * was meant to be rich markdown ends up as raw `##`, `|`-tables and `**`.
 *
 * Strategy:
 *   1. Find the first fence line (after any leading preamble) and the
 *      last fence line.
 *   2. If they bracket essentially the whole body and the inner content
 *      contains obvious markdown structure (headings, tables, bold), the
 *      agent meant for us to render the inner as markdown — strip the
 *      outer fence pair AND any nested fences in between.
 *
 * This is intentionally aggressive: agents that wrap their reply in a
 * single fence trip on this case all the time, and the alternative (raw
 * tables and `##` rendered as plain text) is much worse than losing
 * legitimate-but-rare code-block formatting around nested examples.
 *
 * Returns the input unchanged when it doesn't match the wrapped-body shape.
 */
export function unwrapBareFence(text: string): string {
  const lines = text.split(/\r?\n/);
  const fenceRe = /^```[a-zA-Z0-9_-]*\s*$/;
  let openLine = -1;
  let closeLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (fenceRe.test(lines[i])) {
      if (openLine === -1) openLine = i;
      closeLine = i;
    }
  }
  if (openLine === -1 || closeLine === -1 || openLine === closeLine) return text;

  // Tolerate trailing whitespace after the closing fence but nothing else.
  for (let i = closeLine + 1; i < lines.length; i++) {
    if (lines[i].trim().length > 0) return text;
  }

  const head = lines.slice(0, openLine).join('\n').trimEnd();
  // Drop nested fence lines from the inner content too — they were closing
  // the (invalid) nested code blocks we're now flattening.
  const inner = lines
    .slice(openLine + 1, closeLine)
    .filter((l) => !fenceRe.test(l))
    .join('\n');

  // Only unwrap when the unwrapped body looks like real markdown. Without
  // this guard, we'd flatten legitimate code blocks too.
  const looksLikeMarkdown = /(^|\n)(#{1,6} |[-*] |\| .* \||\*\*[^*]+\*\*)/.test(inner);
  if (!looksLikeMarkdown) return text;
  return head ? `${head}\n\n${inner}` : inner;
}
