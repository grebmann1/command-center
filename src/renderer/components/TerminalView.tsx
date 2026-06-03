import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import type { TerminalSession } from '@shared/types';
import { posixQuote } from '../util/quote';
import { registerFinder, registerTerminal } from '../util/findRegistry';
import { useData } from '../store';

interface Props {
  session: TerminalSession;
  active: boolean;
}

const THEME = {
  background: '#10151c',
  foreground: '#e6edf3',
  cursor: '#d4a017',
  cursorAccent: '#10151c',
  selectionBackground: '#264f78',
  black: '#0b0f15',
  red: '#f85149',
  green: '#3fb950',
  yellow: '#d4a017',
  blue: '#2f81f7',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#e6edf3',
  brightBlack: '#6e7681',
  brightRed: '#ff7b72',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc'
};

export function TerminalView({ session, active }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const offsRef = useRef<Array<() => void>>([]);
  const [dropOver, setDropOver] = useState(false);
  const fontSize = useData((s) => s.fontSize);
  const disposedRef = useRef(false);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        'JetBrains Mono, SF Mono, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: useData.getState().fontSize,
      theme: THEME,
      allowProposedApi: true,
      scrollback: 5000
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(search);
    term.open(ref.current);

    termRef.current = term;
    fitRef.current = fit;
    disposedRef.current = false;

    const offFinder = registerFinder(session.id, {
      findNext: (q, { caseSensitive }) => search.findNext(q, { caseSensitive }),
      findPrev: (q, { caseSensitive }) => search.findPrevious(q, { caseSensitive }),
      clear: () => search.clearDecorations()
    });
    const offHandle = registerTerminal(session.id, {
      clear: () => term.clear()
    });

    // Initial fit + resize
    requestAnimationFrame(() => {
      fit.fit();
      void window.cc.terminals.resize(session.id, term.cols, term.rows).catch(() => {});
    });

    const offData = window.cc.terminals.onData((id, data) => {
      if (id === session.id) term.write(data);
    });
    const offExit = window.cc.terminals.onExit((id) => {
      if (id === session.id) term.write('\r\n\x1b[2m[session exited]\x1b[0m\r\n');
    });
    offsRef.current = [offData, offExit];

    const onInput = term.onData((data) => {
      void window.cc.terminals.write(session.id, data).catch(() => {});
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        void window.cc.terminals.resize(session.id, term.cols, term.rows).catch(() => {});
      } catch {
        /* ignore */
      }
    });
    ro.observe(ref.current);

    return () => {
      disposedRef.current = true;
      ro.disconnect();
      onInput.dispose();
      offsRef.current.forEach((off) => off());
      offFinder();
      offHandle();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [session.id]);

  // Live font size updates
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    requestAnimationFrame(() => {
      try {
        if (disposedRef.current) return;
        fitRef.current?.fit();
        void window.cc.terminals.resize(session.id, term.cols, term.rows).catch(() => {});
      } catch {
        /* ignore */
      }
    });
  }, [fontSize, session.id]);

  // Refit when becoming visible
  useEffect(() => {
    if (active && fitRef.current) {
      requestAnimationFrame(() => {
        try {
          if (disposedRef.current) return;
          fitRef.current?.fit();
          if (termRef.current) {
            void window.cc.terminals
              .resize(session.id, termRef.current.cols, termRef.current.rows)
              .catch(() => {});
          }
          termRef.current?.focus();
        } catch {
          /* ignore */
        }
      });
    }
  }, [active, session.id]);

  const handleDragOver = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes('Files') && !types.includes('text/plain')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropOver) setDropOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setDropOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const paths = files
        .map((f) => window.cc.files.pathForFile(f))
        .filter(Boolean)
        .map(posixQuote)
        .join(' ');
      if (!paths) return;
      void window.cc.terminals.write(session.id, paths).catch(() => {});
      termRef.current?.focus();
      return;
    }
    const text = e.dataTransfer.getData('text/plain');
    if (text && text.startsWith('/')) {
      void window.cc.terminals.write(session.id, posixQuote(text)).catch(() => {});
      termRef.current?.focus();
    }
  };

  return (
    <div
      ref={ref}
      className={`term ${dropOver ? 'drop-over' : ''}`}
      style={{ display: active ? 'block' : 'none' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    />
  );
}
