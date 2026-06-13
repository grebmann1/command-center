// Groups the flat list of URLs scraped from terminal scrollback into a compact,
// rankable shape for the Preview rail. The raw scrape (see urlScrape.ts) yields
// up to 20 distinct URLs per tab, deduped only by exact string — request-logging
// dev servers easily flood that with `/`, `/api/a`, `/assets/x.js`… which are all
// really one server. Collapsing by origin (scheme://host:port) turns that back
// into "1 server, N paths".

export interface DetectedUrl {
  url: string;
  fromTabTitle: string;
}

export interface OriginPath {
  // Full URL for this path (origin + pathname/query, as printed).
  url: string;
  // Display label: the path portion ("/", "/api/health"). Falls back to the
  // full url if parsing fails.
  label: string;
}

export interface OriginGroup {
  // scheme://host:port — the key we collapse on and what the rail row shows.
  origin: string;
  // Host:port without scheme, for compact display.
  display: string;
  // Whether this origin is local/LAN (previewable dev server) vs. a remote host.
  kind: 'local' | 'remote';
  // Distinct paths seen under this origin, freshest first. Always contains at
  // least one entry. The first is what clicking the origin row navigates to.
  paths: OriginPath[];
  // Tab title the freshest path came from (rail subtitle).
  fromTabTitle: string;
  // Ranking score — higher sorts first. Local dev ports win.
  score: number;
}

export interface GroupedPreview {
  // Local/LAN origins, expanded by default, best-first.
  local: OriginGroup[];
  // Remote/3rd-party origins, collapsed under "Other" by default, best-first.
  remote: OriginGroup[];
}

// Ports we treat as "almost certainly a dev server the user wants to preview".
// Used only for ranking, never for filtering — an unknown port still shows.
const DEV_PORTS = new Set([
  3000, 3001, 4200, 4321, 5000, 5173, 5174, 8000, 8080, 8081, 8888, 9000
]);

const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;

// RFC1918 / link-local ranges — a server on the user's LAN (e.g. accessing the
// dev server from a phone) is still "local" for preview purposes.
function isLanHost(host: string): boolean {
  if (LOCAL_HOST_RE.test(host)) return true;
  // Strip IPv6 brackets for the test below.
  const h = host.replace(/^\[|\]$/g, '');
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

interface Parsed {
  origin: string;
  display: string;
  host: string;
  port: number | null;
  pathLabel: string;
}

// Parse without relying on the URL API throwing on odd inputs — terminals print
// plenty of not-quite-valid URLs. Returns null when we can't make sense of it.
function parse(raw: string): Parsed | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname;
  if (!host) return null;
  const portNum = u.port ? Number(u.port) : null;
  const origin = `${u.protocol}//${u.host}`; // u.host includes :port when present
  const display = u.host;
  const pathLabel = (u.pathname || '/') + (u.search || '');
  return { origin, display, host, port: portNum, pathLabel };
}

function scoreOrigin(p: Parsed, kind: 'local' | 'remote', firstSeenIndex: number): number {
  let s = 0;
  if (kind === 'local') s += 1000;
  if (LOCAL_HOST_RE.test(p.host)) s += 100; // true localhost over LAN IP
  if (p.port !== null && DEV_PORTS.has(p.port)) s += 50;
  // Earlier in the freshest-first input = printed more recently = slightly
  // higher. Small weight so it only breaks ties.
  s += Math.max(0, 20 - firstSeenIndex);
  return s;
}

// `detected` is expected freshest-first (urlScrape walks newest-first). We
// preserve that ordering for paths within an origin.
export function groupDetectedUrls(detected: DetectedUrl[]): GroupedPreview {
  const byOrigin = new Map<string, OriginGroup>();
  const seenPath = new Set<string>(); // origin|url — dedupe identical paths

  detected.forEach((d, index) => {
    const p = parse(d.url);
    if (!p) return;
    const kind: 'local' | 'remote' = isLanHost(p.host) ? 'local' : 'remote';

    let group = byOrigin.get(p.origin);
    if (!group) {
      group = {
        origin: p.origin,
        display: p.display,
        kind,
        paths: [],
        fromTabTitle: d.fromTabTitle,
        score: scoreOrigin(p, kind, index)
      };
      byOrigin.set(p.origin, group);
    }

    const pathKey = `${p.origin}|${d.url}`;
    if (!seenPath.has(pathKey)) {
      seenPath.add(pathKey);
      group.paths.push({ url: d.url, label: p.pathLabel });
    }
  });

  const groups = [...byOrigin.values()];
  const byScoreThenName = (a: OriginGroup, b: OriginGroup) =>
    b.score - a.score || a.display.localeCompare(b.display);

  return {
    local: groups.filter((g) => g.kind === 'local').sort(byScoreThenName),
    remote: groups.filter((g) => g.kind === 'remote').sort(byScoreThenName)
  };
}

// The single best origin to auto-load when the Preview pane first opens. Returns
// its root URL (origin + freshest path), or null if there's no local candidate.
export function primaryPreviewUrl(grouped: GroupedPreview): string | null {
  const best = grouped.local[0];
  if (!best) return null;
  return best.paths[0]?.url ?? best.origin;
}
