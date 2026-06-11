import { useEffect, useRef, useState } from 'react';

/**
 * Render a single mermaid code block to inline SVG.
 *
 * mermaid is heavy (~500KB) and only needed when a markdown body actually
 * contains a ```mermaid fence, so it's lazy-loaded on first render via a
 * dynamic import — the chunk never enters the main bundle for users who
 * never open a diagram.
 *
 * On a parse/render error we fall back to showing the raw source in a
 * <pre>, matching how the block would have looked before mermaid support —
 * a malformed diagram is no worse than the prior behaviour, never a blank.
 */

// Module-level singleton: initialize mermaid exactly once across all
// diagrams, and reuse the resolved module for every subsequent render.
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

function currentTheme(): 'dark' | 'default' {
  return document.documentElement.getAttribute('data-theme') === 'light'
    ? 'default'
    : 'dark';
}

async function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      const mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: currentTheme(),
        securityLevel: 'strict',
        fontFamily: 'inherit'
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

// Monotonic id source — mermaid.render requires a unique DOM id per call.
let renderSeq = 0;

export function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(false);

    void (async () => {
      try {
        const mermaid = await loadMermaid();
        const id = `inbox-mermaid-${renderSeq++}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) setSvg(rendered);
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return <pre className="inbox-md-code">{code}</pre>;
  }
  if (svg === null) {
    return <div className="inbox-mermaid-loading">Rendering diagram…</div>;
  }
  return (
    <div
      ref={containerRef}
      className="inbox-mermaid"
      // mermaid output is its own trusted SVG (securityLevel 'strict'
      // sanitizes the diagram source); inject it as markup.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
