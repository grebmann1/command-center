import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  ClipboardCopy,
  ExternalLink,
  Globe,
  X,
  Bug,
  RefreshCw,
  History
} from 'lucide-react';
import { useData, useUi } from '../store';
import { getTerminal } from '../util/findRegistry';
import type { ElectronWebviewElement } from '../types/webview';
import type { TerminalSession } from '@shared/types';

interface Props {
  projectId: string;
}

interface DetectedUrl {
  url: string;
  fromTabTitle: string;
}

// Viewport presets for simulating different screen sizes. `fit` lets the
// webview fill available space (default). Sizes are CSS pixels.
interface ViewportPreset {
  id: string;
  label: string;
  width?: number;
  height?: number;
}
const VIEWPORT_PRESETS: ViewportPreset[] = [
  { id: 'fit', label: 'Fit' },
  { id: 'mobile', label: 'Mobile · 375×667', width: 375, height: 667 },
  { id: 'mobile-l', label: 'Mobile L · 414×896', width: 414, height: 896 },
  { id: 'tablet', label: 'Tablet · 768×1024', width: 768, height: 1024 },
  { id: 'laptop', label: 'Laptop · 1280×800', width: 1280, height: 800 },
  { id: 'desktop', label: 'Desktop · 1440×900', width: 1440, height: 900 },
  { id: 'fullhd', label: 'Full HD · 1920×1080', width: 1920, height: 1080 }
];

// Stable empty reference — Zustand selectors that return `?? []` produce a
// fresh array on every store update, which makes any useEffect with `tabs`
// in its deps run forever.
const EMPTY_TABS: TerminalSession[] = [];

// Session-scoped per-project preview URL memory. Switching projects unmounts
// the pane (`{isPreview && project && <PreviewPane …/>}` in Workspace.tsx),
// so we cache the last visited URL here to restore it on remount. Not
// persisted across app restarts — dev servers usually aren't running.
const lastUrlByProject = new Map<string, string>();

const HISTORY_LIMIT = 12;
// Persisted MRU list of URLs visited in the preview pane (per project).
// Read from ProjectSettings.previewUrls on mount, written back debounced
// when the user navigates somewhere new.
const historyByProject = new Map<string, string[]>();
const historyLoaded = new Set<string>();
const historyWriteTimers = new Map<string, number>();

export function PreviewPane({ projectId }: Props) {
  const tabs = useData((s) => s.terminals[projectId]) ?? EMPTY_TABS;
  const pushToast = useUi((s) => s.pushToast);
  const navRequest = useUi((s) => s.previewNav[projectId]);
  const [history, setHistory] = useState<string[]>(
    () => historyByProject.get(projectId) ?? []
  );

  // Lazy-load persisted history once per project (the cache survives remounts
  // when toggling between Preview ↔ Terminals, so we only hit IPC the first
  // time we see this project in this session).
  useEffect(() => {
    if (historyLoaded.has(projectId)) return;
    historyLoaded.add(projectId);
    let cancelled = false;
    window.cc.projectSettings
      .get(projectId)
      .then((s) => {
        if (cancelled) return;
        const list = Array.isArray(s.previewUrls) ? s.previewUrls.slice(0, HISTORY_LIMIT) : [];
        historyByProject.set(projectId, list);
        setHistory(list);
      })
      .catch(() => {
        /* ignore — empty history is fine */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const recordVisit = (url: string) => {
    if (!/^https?:\/\//i.test(url)) return;
    const cur = historyByProject.get(projectId) ?? [];
    if (cur[0] === url) return;
    const next = [url, ...cur.filter((u) => u !== url)].slice(0, HISTORY_LIMIT);
    historyByProject.set(projectId, next);
    setHistory(next);
    const existing = historyWriteTimers.get(projectId);
    if (existing !== undefined) window.clearTimeout(existing);
    const t = window.setTimeout(() => {
      historyWriteTimers.delete(projectId);
      window.cc.projectSettings
        .set(projectId, { previewUrls: historyByProject.get(projectId) ?? [] })
        .catch(() => {});
    }, 600);
    historyWriteTimers.set(projectId, t);
  };

  const removeFromHistory = (url: string) => {
    const cur = historyByProject.get(projectId) ?? [];
    if (!cur.includes(url)) return;
    const next = cur.filter((u) => u !== url);
    historyByProject.set(projectId, next);
    setHistory(next);
    window.cc.projectSettings
      .set(projectId, { previewUrls: next })
      .catch(() => {});
  };

  const initialUrl = lastUrlByProject.get(projectId) ?? 'about:blank';
  const [target, setTarget] = useState<string>(initialUrl);
  // Address bar text — decoupled from `target` so the user can type without
  // the webview reloading on every keystroke.
  const [addr, setAddr] = useState<string>(
    initialUrl === 'about:blank' ? '' : initialUrl
  );
  const [detected, setDetected] = useState<DetectedUrl[]>([]);
  const [busy, setBusy] = useState(false);
  const [viewport, setViewport] = useState<string>('fit');
  const [rotated, setRotated] = useState(false);
  const wvRef = useRef<ElectronWebviewElement | null>(null);
  const addrRef = useRef<HTMLInputElement>(null);

  // Browser-style ⌘L: when the shortcut fires and we're already mounted,
  // focus + select the address bar so the user can type a URL immediately.
  useEffect(() => {
    const onFocus = () => {
      addrRef.current?.focus();
      addrRef.current?.select();
    };
    window.addEventListener('preview:focus-address', onFocus);
    return () => window.removeEventListener('preview:focus-address', onFocus);
  }, []);

  // Poll registered terminal handles for URLs every 2s while the pane lives.
  // Reuses prior `detected` state when the URL set is byte-identical, so
  // downstream effects keyed on `detected` don't churn every tick.
  useEffect(() => {
    const tick = () => {
      const out: DetectedUrl[] = [];
      const seen = new Set<string>();
      for (const t of tabs) {
        const handle = getTerminal(t.id);
        const urls = handle?.getUrls?.() ?? [];
        for (const u of urls) {
          if (seen.has(u)) continue;
          seen.add(u);
          out.push({ url: u, fromTabTitle: t.title });
        }
      }
      setDetected((prev) => {
        if (prev.length !== out.length) return out;
        for (let i = 0; i < out.length; i++) {
          if (prev[i].url !== out[i].url || prev[i].fromTabTitle !== out[i].fromTabTitle) {
            return out;
          }
        }
        return prev;
      });
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, [tabs]);

  // First localhost URL we ever see — promote it as the auto-load target so
  // a fresh "open Preview" lands on the dev server instead of about:blank.
  // Only fires while target is still about:blank (don't yank the user away
  // once they navigated somewhere).
  useEffect(() => {
    if (target !== 'about:blank') return;
    const local = detected.find(
      (d) =>
        d.url.startsWith('http://localhost') ||
        d.url.startsWith('http://127.0.0.1')
    );
    if (local) {
      setTarget(local.url);
      setAddr(local.url);
      setBusy(true);
      lastUrlByProject.set(projectId, local.url);
      recordVisit(local.url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected, target, projectId]);

  // External nav requests (e.g. terminal link click). Re-fires on nonce bump
  // so the same URL can be re-requested. The `navigate` function is defined
  // below; we re-derive its body inline to avoid a forward-reference dance.
  const lastNavNonceRef = useRef<number>(0);
  useEffect(() => {
    if (!navRequest) return;
    if (navRequest.nonce === lastNavNonceRef.current) return;
    lastNavNonceRef.current = navRequest.nonce;
    const url = navRequest.url;
    if (!/^https?:\/\//i.test(url)) return;
    setTarget(url);
    setAddr(url);
    setBusy(true);
    lastUrlByProject.set(projectId, url);
    recordVisit(url);
    // recordVisit reads from a module-scoped Map, so referencing it from this
    // effect doesn't require it in the dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRequest, projectId]);

  // Group detected URLs: localhost first, then everything else.
  const grouped = useMemo(() => {
    const local: DetectedUrl[] = [];
    const remote: DetectedUrl[] = [];
    for (const d of detected) {
      const isLocal =
        d.url.startsWith('http://localhost') ||
        d.url.startsWith('http://127.0.0.1') ||
        d.url.startsWith('http://0.0.0.0');
      (isLocal ? local : remote).push(d);
    }
    return { local, remote };
  }, [detected]);

  // Recents: persisted URLs minus anything currently visible as a live
  // detected URL (avoids showing the same item twice in the rail).
  const recents = useMemo(() => {
    if (history.length === 0) return [];
    const live = new Set(detected.map((d) => d.url));
    return history.filter((u) => !live.has(u));
  }, [history, detected]);

  const navigate = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    // Bare port shortcuts: ":3000" or "3000" → localhost on that port. Common
    // muscle memory when you know the dev server port without typing the host.
    const portOnly = /^:?(\d{2,5})(\/.*)?$/.exec(trimmed);
    let url: string;
    if (portOnly) {
      url = `http://localhost:${portOnly[1]}${portOnly[2] ?? ''}`;
    } else if (/^https?:\/\//i.test(trimmed) || trimmed === 'about:blank') {
      url = trimmed;
    } else {
      url = `http://${trimmed}`;
    }
    if (
      !url.startsWith('http://') &&
      !url.startsWith('https://') &&
      url !== 'about:blank'
    ) {
      pushToast(`Cannot load ${raw}`, 'error');
      return;
    }
    setTarget(url);
    setAddr(url);
    setBusy(true);
    lastUrlByProject.set(projectId, url);
    recordVisit(url);
  };

  // Wire webview lifecycle events once mounted.
  useEffect(() => {
    const wv = wvRef.current;
    if (!wv) return;
    const onStart = () => setBusy(true);
    const onStop = () => {
      setBusy(false);
      try {
        setAddr(wv.getURL());
      } catch {
        /* ignore */
      }
    };
    // SPA route changes (history.pushState) — keep the address bar honest
    // even when the page never reloads. did-navigate-in-page fires for these.
    const onInPage = (e: Event) => {
      const ev = e as Event & { url?: string; isMainFrame?: boolean };
      if (ev.isMainFrame === false) return;
      if (ev.url) setAddr(ev.url);
    };
    const onFail = (e: Event) => {
      setBusy(false);
      const ev = e as Event & { errorDescription?: string; validatedURL?: string };
      // -3 / "ERR_ABORTED" fires when navigation is replaced — ignore.
      const desc = ev.errorDescription ?? '';
      if (desc && desc !== 'ERR_ABORTED') {
        pushToast(`Failed to load: ${desc}`, 'error');
      }
    };
    wv.addEventListener('did-start-loading', onStart);
    wv.addEventListener('did-stop-loading', onStop);
    wv.addEventListener('did-navigate-in-page', onInPage as EventListener);
    wv.addEventListener('did-fail-load', onFail as EventListener);
    return () => {
      wv.removeEventListener('did-start-loading', onStart);
      wv.removeEventListener('did-stop-loading', onStop);
      wv.removeEventListener('did-navigate-in-page', onInPage as EventListener);
      wv.removeEventListener('did-fail-load', onFail as EventListener);
    };
    // Re-bind whenever the target url changes — the webview node is the
    // same DOM element but we want to reset listeners between navigations.
  }, [target, pushToast]);

  const back = () => {
    try {
      if (wvRef.current?.canGoBack()) wvRef.current.goBack();
    } catch {
      /* ignore */
    }
  };
  const forward = () => {
    try {
      if (wvRef.current?.canGoForward()) wvRef.current.goForward();
    } catch {
      /* ignore */
    }
  };
  const reload = () => {
    try {
      wvRef.current?.reload();
    } catch {
      /* ignore */
    }
  };
  const copyUrl = () => {
    const u = (() => {
      try {
        return wvRef.current?.getURL() ?? target;
      } catch {
        return target;
      }
    })();
    void navigator.clipboard.writeText(u).then(
      () => pushToast('URL copied', 'info'),
      () => pushToast('Failed to copy URL', 'error')
    );
  };
  // Toggle DevTools for the embedded page. Bails out on about:blank because
  // the underlying webContents may not be attached yet, which surfaces as a
  // confusing "Could not open DevTools" toast.
  const toggleDevTools = () => {
    const wv = wvRef.current;
    if (!wv) return;
    if (target === 'about:blank') {
      pushToast('Load a page first', 'info');
      return;
    }
    try {
      if (wv.isDevToolsOpened()) {
        wv.closeDevTools();
      } else {
        wv.openDevTools();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      pushToast(`DevTools: ${msg}`, 'error');
    }
  };

  const openExternal = () => {
    const u = (() => {
      try {
        return wvRef.current?.getURL() ?? target;
      } catch {
        return target;
      }
    })();
    if (!/^https?:\/\//i.test(u)) return;
    // Hand off to Electron — main-side new-window/setWindowOpenHandler routes
    // this to the system browser via shell.openExternal.
    window.open(u, '_blank', 'noopener');
  };

  return (
    <div className="preview-pane">
      <aside className="preview-rail">
        <div className="preview-rail-head">
          <Globe size={12} />
          <span>Detected URLs</span>
        </div>
        {detected.length === 0 && recents.length === 0 ? (
          <div className="preview-rail-empty">
            No URLs in scrollback yet.<br />
            Start a dev server in any tab.
          </div>
        ) : (
          <>
            {grouped.local.length > 0 && (
              <UrlGroup
                title="Local"
                items={grouped.local}
                onPick={navigate}
                activeUrl={target}
              />
            )}
            {grouped.remote.length > 0 && (
              <UrlGroup
                title="Remote"
                items={grouped.remote}
                onPick={navigate}
                activeUrl={target}
              />
            )}
            {recents.length > 0 && (
              <RecentsGroup
                items={recents}
                onPick={navigate}
                onRemove={removeFromHistory}
                activeUrl={target}
              />
            )}
          </>
        )}
      </aside>
      <div className="preview-main">
        <header className="preview-chrome">
          <button
            type="button"
            className="preview-btn"
            onClick={back}
            title="Back"
            aria-label="Back"
          >
            <ArrowLeft size={14} />
          </button>
          <button
            type="button"
            className="preview-btn"
            onClick={forward}
            title="Forward"
            aria-label="Forward"
          >
            <ArrowRight size={14} />
          </button>
          <button
            type="button"
            className={`preview-btn ${busy ? 'spin' : ''}`}
            onClick={reload}
            title="Reload"
            aria-label="Reload"
          >
            <RotateCw size={14} />
          </button>
          <input
            ref={addrRef}
            className="preview-address"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                navigate(addr);
              }
            }}
            placeholder="Type a URL or pick one from the left…"
            spellCheck={false}
            list={`preview-history-${projectId}`}
          />
          <datalist id={`preview-history-${projectId}`}>
            {history.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <button
            type="button"
            className="preview-btn"
            onClick={copyUrl}
            title="Copy URL"
            aria-label="Copy URL"
          >
            <ClipboardCopy size={14} />
          </button>
          <button
            type="button"
            className="preview-btn"
            onClick={toggleDevTools}
            disabled={target === 'about:blank'}
            title={
              target === 'about:blank'
                ? 'Load a page first'
                : 'Toggle DevTools for this page'
            }
            aria-label="Toggle DevTools"
          >
            <Bug size={14} />
          </button>
          <button
            type="button"
            className="preview-btn"
            onClick={openExternal}
            title="Open in default browser"
            aria-label="Open in default browser"
          >
            <ExternalLink size={14} />
          </button>
          <select
            className="preview-viewport"
            value={viewport}
            onChange={(e) => setViewport(e.target.value)}
            title="Viewport size"
            aria-label="Viewport size"
          >
            {VIEWPORT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {viewport !== 'fit' && (
            <button
              type="button"
              className="preview-btn"
              onClick={() => setRotated((r) => !r)}
              title="Rotate viewport (swap width/height)"
              aria-label="Rotate viewport"
              aria-pressed={rotated}
            >
              <RefreshCw size={14} />
            </button>
          )}
          {target !== 'about:blank' && (
            <button
              type="button"
              className="preview-btn"
              onClick={() => {
                setTarget('about:blank');
                setAddr('');
                lastUrlByProject.delete(projectId);
              }}
              title="Close page"
              aria-label="Close page"
            >
              <X size={14} />
            </button>
          )}
        </header>
        <div className={`preview-frame ${viewport !== 'fit' ? 'sized' : ''}`}>
          {(() => {
            const preset = VIEWPORT_PRESETS.find((p) => p.id === viewport);
            const w = preset?.width;
            const h = preset?.height;
            const sized = w !== undefined && h !== undefined;
            const dispW = sized ? (rotated ? h : w) : undefined;
            const dispH = sized ? (rotated ? w : h) : undefined;
            const style: React.CSSProperties = sized
              ? {
                  width: dispW,
                  height: dispH,
                  maxWidth: '100%',
                  maxHeight: '100%',
                  border: '1px solid var(--border-default)',
                  background: '#fff'
                }
              : { width: '100%', height: '100%', border: 'none' };
            return (
              <webview
                ref={wvRef as unknown as React.LegacyRef<ElectronWebviewElement>}
                src={target}
                partition={`persist:project-${projectId}`}
                allowpopups={true}
                style={style}
              />
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function UrlGroup({
  title,
  items,
  onPick,
  activeUrl
}: {
  title: string;
  items: DetectedUrl[];
  onPick: (url: string) => void;
  activeUrl: string;
}) {
  return (
    <div className="preview-rail-group">
      <div className="preview-rail-label">{title}</div>
      {items.map((d) => (
        <button
          key={d.url}
          type="button"
          className={`preview-rail-item ${activeUrl === d.url ? 'active' : ''}`}
          onClick={() => onPick(d.url)}
          title={`${d.url} · from ${d.fromTabTitle}`}
        >
          <span className="preview-rail-url">{d.url}</span>
          <span className="preview-rail-from">{d.fromTabTitle}</span>
        </button>
      ))}
    </div>
  );
}

function RecentsGroup({
  items,
  onPick,
  onRemove,
  activeUrl
}: {
  items: string[];
  onPick: (url: string) => void;
  onRemove: (url: string) => void;
  activeUrl: string;
}) {
  return (
    <div className="preview-rail-group">
      <div className="preview-rail-label">
        <History size={10} /> Recent
      </div>
      {items.map((url) => (
        <div
          key={url}
          className={`preview-rail-item recent ${activeUrl === url ? 'active' : ''}`}
        >
          <button
            type="button"
            className="preview-rail-pick"
            onClick={() => onPick(url)}
            title={url}
          >
            <span className="preview-rail-url">{url}</span>
          </button>
          <button
            type="button"
            className="preview-rail-rm"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(url);
            }}
            title="Remove from history"
            aria-label="Remove from history"
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}
