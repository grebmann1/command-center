/**
 * Minimal, dependency-free markdown renderer for the session post-mortem.
 *
 * `cu sessions post-mortem` emits markdown (NOT the rich-text HTML GUS deals
 * with), so rather than pull in a markdown library we render the small subset
 * the Overseer post-mortems actually use: headings, bullet/numbered lists, fenced
 * code blocks, inline `code`, **bold**, and paragraphs. Anything unrecognized
 * falls through as plain text — never raw HTML, so there's no injection surface
 * (we only ever build React elements from parsed structure, never assign markup).
 *
 * Block-level only with light inline formatting — deliberately not a full
 * CommonMark implementation. Good enough to read a post-mortem; not a renderer
 * we'd reuse elsewhere.
 */
import { createElement, type ReactNode } from 'react';

/** Inline pass: `code`, **bold**, *italic*. Returns an array of React nodes. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Split on the inline markers, keeping the delimiters via capture groups.
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(pattern)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    const tok = m[0];
    const key = `${keyPrefix}-i${i++}`;
    if (tok.startsWith('`')) {
      nodes.push(createElement('code', { key }, tok.slice(1, -1)));
    } else if (tok.startsWith('**')) {
      nodes.push(createElement('strong', { key }, tok.slice(2, -2)));
    } else {
      nodes.push(createElement('em', { key }, tok.slice(1, -1)));
    }
    last = idx + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function renderMarkdown(md: string): ReactNode {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      const text = para.join(' ');
      blocks.push(createElement('p', { key: `p${key++}` }, ...renderInline(text, `p${key}`)));
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const tag = list.ordered ? 'ol' : 'ul';
      const items = list.items.map((it, idx) =>
        createElement('li', { key: `li${idx}` }, ...renderInline(it, `li${key}-${idx}`))
      );
      blocks.push(createElement(tag, { key: `l${key++}` }, ...items));
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw;
    // Fenced code block toggling.
    if (line.trim().startsWith('```')) {
      if (code) {
        blocks.push(
          createElement(
            'pre',
            { key: `pre${key++}`, className: 'cu-code' },
            createElement('code', null, code.join('\n'))
          )
        );
        code = null;
      } else {
        flushPara();
        flushList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushPara();
      flushList();
      const level = Math.min(6, heading[1].length + 1); // h2..h5
      blocks.push(
        createElement(`h${level}`, { key: `h${key++}` }, ...renderInline(heading[2], `h${key}`))
      );
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (bullet || ordered) {
      flushPara();
      const isOrdered = !!ordered;
      const item = (bullet ?? ordered)![1];
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(item);
      continue;
    }

    if (line.trim() === '') {
      flushPara();
      flushList();
      continue;
    }

    // Plain text line → accumulate into the current paragraph.
    flushList();
    para.push(line.trim());
  }

  flushPara();
  flushList();
  if (code) {
    blocks.push(
      createElement(
        'pre',
        { key: `pre${key++}`, className: 'cu-code' },
        createElement('code', null, code.join('\n'))
      )
    );
  }

  return createElement('div', { className: 'cu-markdown-body' }, ...blocks);
}
