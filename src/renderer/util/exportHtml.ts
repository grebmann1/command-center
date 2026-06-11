/**
 * Serialize an already-rendered DOM subtree into a self-contained HTML
 * document for PDF export.
 *
 * The inbox detail is rendered live — mermaid blocks are inline SVG, code
 * blocks carry highlight.js spans. Rather than re-run a markdown pipeline in
 * the main process (and risk drift), we snapshot exactly what's on screen:
 * clone the node, inline every accessible stylesheet, and carry the active
 * theme across so colors match.
 */

/** Pull cssText out of every same-origin stylesheet on the page. */
function collectCss(): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      for (const rule of Array.from(rules)) chunks.push(rule.cssText);
    } catch {
      // Cross-origin sheet — cssRules access throws. All app CSS is bundled
      // same-origin, so skipping these loses nothing.
    }
  }
  return chunks.join('\n');
}

/**
 * Build a standalone HTML document string from a rendered element.
 *
 * @param el     the subtree to export (cloned, not mutated)
 * @param title  document <title> and heading
 */
export function buildStandaloneHtml(el: HTMLElement, title: string): string {
  const css = collectCss();
  const theme = document.documentElement.getAttribute('data-theme') ?? 'dark';
  const bodyHtml = el.cloneNode(true) as HTMLElement;

  // The export is a document, not a panel — let it size to content and use a
  // readable page margin rather than the app's fixed-height flex layout.
  const reset = `
    html, body { height: auto; margin: 0; padding: 0; }
    body { background: var(--bg-panel); padding: 24px 28px; }
    .pdf-export-root { max-width: 100%; }
    /* Keep diagrams and code blocks from splitting across PDF pages. */
    .inbox-mermaid, .inbox-md pre, .inbox-md-table-wrap { break-inside: avoid; }
  `;

  return [
    '<!doctype html>',
    `<html data-theme="${escapeAttr(theme)}">`,
    '<head>',
    '<meta charset="utf-8" />',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${css}</style>`,
    `<style>${reset}</style>`,
    '</head>',
    '<body>',
    `<div class="pdf-export-root">${bodyHtml.outerHTML}</div>`,
    '</body>',
    '</html>'
  ].join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}
