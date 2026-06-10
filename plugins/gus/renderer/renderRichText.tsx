/**
 * Render GUS rich-text (`Details__c`) safely as React elements.
 *
 * The field is untrusted HTML authored in GUS's rich-text editor. Rather than
 * injecting any HTML string, we parse it with `DOMParser` and walk the tree,
 * emitting React elements only for an allowlisted set of tags. Text nodes
 * become strings; anything not on the allowlist is unwrapped to its
 * (sanitised) children. Link hrefs are restricted to http(s)/anchor and open
 * via the host callback, never in-app navigation.
 *
 * `DOMParser.parseFromString(html, 'text/html')` neither executes scripts nor
 * loads resources, so the parse is inert; the emitted tree contains only the
 * allowlisted React elements below.
 */

import { createElement, type ReactNode } from 'react';

/** tag → the React intrinsic element to emit. */
const ALLOWED: Record<string, string> = {
  P: 'p', BR: 'br', B: 'strong', STRONG: 'strong', I: 'em', EM: 'em',
  U: 'u', S: 's', SPAN: 'span', DIV: 'div', UL: 'ul', OL: 'ol', LI: 'li',
  CODE: 'code', PRE: 'pre', BLOCKQUOTE: 'blockquote',
  H1: 'h4', H2: 'h4', H3: 'h5', H4: 'h5', H5: 'h6', H6: 'h6',
  TABLE: 'table', THEAD: 'thead', TBODY: 'tbody', TR: 'tr', TD: 'td',
  TH: 'th', HR: 'hr'
};

function safeHref(href: string | null): string | null {
  if (!href) return null;
  const v = href.trim();
  if (/^https?:\/\//i.test(v) || v.startsWith('#')) return v;
  return null;
}

function walk(node: Node, keyPrefix: string, onLink: (url: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  for (const child of Array.from(node.childNodes)) {
    const key = `${keyPrefix}-${i++}`;
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (text) out.push(text);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName.toUpperCase();
    const children = walk(el, key, onLink);

    if (tag === 'A') {
      const href = safeHref(el.getAttribute('href'));
      if (href) {
        out.push(
          createElement(
            'a',
            {
              key,
              href,
              onClick: (e: React.MouseEvent) => {
                e.preventDefault();
                onLink(href);
              }
            },
            ...children
          )
        );
      } else {
        out.push(...children);
      }
      continue;
    }

    const mapped = ALLOWED[tag];
    if (mapped) {
      out.push(
        mapped === 'br' || mapped === 'hr'
          ? createElement(mapped, { key })
          : createElement(mapped, { key }, ...children)
      );
    } else {
      // Unknown tag: keep its sanitised children, drop the wrapper.
      out.push(...children);
    }
  }
  return out;
}

/** Parse `html` and return safe React nodes. `onLink` handles allowed links. */
export function renderRichText(html: string, onLink: (url: string) => void): ReactNode {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return walk(doc.body, 'rt', onLink);
}
