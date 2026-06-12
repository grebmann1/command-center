let hostReact = null;
const GLOBAL_KEY = "__CCTC_HOST_REACT__";
function setHostReact(react) {
  hostReact = react;
}
function getHostReact() {
  if (hostReact) return hostReact;
  const fromGlobal = globalThis[GLOBAL_KEY];
  if (fromGlobal) {
    hostReact = fromGlobal;
    return hostReact;
  }
  throw new Error(
    "gus extension: host React unavailable — the host must set globalThis." + GLOBAL_KEY + " before import, or call activate({ React })."
  );
}
const Fragment = Symbol.for("gus-ext.jsx.Fragment");
function build(type, props, key) {
  const React = getHostReact();
  const realType = type === Fragment ? React.Fragment : type;
  const { children, ...rest } = props ?? {};
  const restWithKey = key === void 0 ? rest : { ...rest, key };
  if (Array.isArray(children)) {
    return React.createElement(realType, restWithKey, ...children);
  }
  if (children === void 0) {
    return React.createElement(realType, restWithKey);
  }
  return React.createElement(realType, restWithKey, children);
}
function jsx(type, props, key) {
  return build(type, props, key);
}
function jsxs(type, props, key) {
  return build(type, props, key);
}
const useState = (...a) => getHostReact().useState(...a);
const useEffect = (...a) => getHostReact().useEffect(...a);
const useCallback = (...a) => getHostReact().useCallback(...a);
const useMemo = (...a) => getHostReact().useMemo(...a);
const useRef = (...a) => getHostReact().useRef(...a);
const createElement = (...a) => getHostReact().createElement(...a);
const forwardRef = (...a) => getHostReact().forwardRef(...a);
new Proxy(
  {},
  {
    get(_t, prop) {
      return getHostReact()[prop];
    },
    has(_t, prop) {
      return prop in getHostReact();
    }
  }
);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && array.indexOf(className) === index;
}).join(" ");
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
var defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Icon = forwardRef(
  ({
    color = "currentColor",
    size = 24,
    strokeWidth = 2,
    absoluteStrokeWidth,
    className = "",
    children,
    iconNode,
    ...rest
  }, ref) => {
    return createElement(
      "svg",
      {
        ref,
        ...defaultAttributes,
        width: size,
        height: size,
        stroke: color,
        strokeWidth: absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth,
        className: mergeClasses("lucide", className),
        ...rest
      },
      [
        ...iconNode.map(([tag, attrs]) => createElement(tag, attrs)),
        ...Array.isArray(children) ? children : [children]
      ]
    );
  }
);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const createLucideIcon = (iconName, iconNode) => {
  const Component = forwardRef(
    ({ className, ...props }, ref) => createElement(Icon, {
      ref,
      iconNode,
      className: mergeClasses(`lucide-${toKebabCase(iconName)}`, className),
      ...props
    })
  );
  Component.displayName = `${iconName}`;
  return Component;
};
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const BookOpen = createLucideIcon("BookOpen", [
  ["path", { d: "M12 7v14", key: "1akyts" }],
  [
    "path",
    {
      d: "M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",
      key: "ruj8y"
    }
  ]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Bug = createLucideIcon("Bug", [
  ["path", { d: "m8 2 1.88 1.88", key: "fmnt4t" }],
  ["path", { d: "M14.12 3.88 16 2", key: "qol33r" }],
  ["path", { d: "M9 7.13v-1a3.003 3.003 0 1 1 6 0v1", key: "d7y7pr" }],
  [
    "path",
    {
      d: "M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6",
      key: "xs1cw7"
    }
  ],
  ["path", { d: "M12 20v-9", key: "1qisl0" }],
  ["path", { d: "M6.53 9C4.6 8.8 3 7.1 3 5", key: "32zzws" }],
  ["path", { d: "M6 13H2", key: "82j7cp" }],
  ["path", { d: "M3 21c0-2.1 1.7-3.9 3.8-4", key: "4p0ekp" }],
  ["path", { d: "M20.97 5c0 2.1-1.6 3.8-3.5 4", key: "18gb23" }],
  ["path", { d: "M22 13h-4", key: "1jl80f" }],
  ["path", { d: "M17.2 17c2.1.1 3.8 1.9 3.8 4", key: "k3fwyw" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const CalendarClock = createLucideIcon("CalendarClock", [
  ["path", { d: "M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5", key: "1osxxc" }],
  ["path", { d: "M16 2v4", key: "4m81vk" }],
  ["path", { d: "M8 2v4", key: "1cmpym" }],
  ["path", { d: "M3 10h5", key: "r794hk" }],
  ["path", { d: "M17.5 17.5 16 16.3V14", key: "akvzfd" }],
  ["circle", { cx: "16", cy: "16", r: "6", key: "qoo3c4" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const CircleAlert = createLucideIcon("CircleAlert", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["line", { x1: "12", x2: "12", y1: "8", y2: "12", key: "1pkeuh" }],
  ["line", { x1: "12", x2: "12.01", y1: "16", y2: "16", key: "4dfq90" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const CircleDot = createLucideIcon("CircleDot", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["circle", { cx: "12", cy: "12", r: "1", key: "41hilf" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const ExternalLink = createLucideIcon("ExternalLink", [
  ["path", { d: "M15 3h6v6", key: "1q9fwt" }],
  ["path", { d: "M10 14 21 3", key: "gplh6r" }],
  ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", key: "a6xqqp" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const FileText = createLucideIcon("FileText", [
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", key: "1rqfz7" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  ["path", { d: "M10 9H8", key: "b1mrlr" }],
  ["path", { d: "M16 13H8", key: "t4e002" }],
  ["path", { d: "M16 17H8", key: "z1uh3a" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Film = createLucideIcon("Film", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M7 3v18", key: "bbkbws" }],
  ["path", { d: "M3 7.5h4", key: "zfgn84" }],
  ["path", { d: "M3 12h18", key: "1i2n21" }],
  ["path", { d: "M3 16.5h4", key: "1230mu" }],
  ["path", { d: "M17 3v18", key: "in4fa5" }],
  ["path", { d: "M17 7.5h4", key: "myr1c1" }],
  ["path", { d: "M17 16.5h4", key: "go4c1d" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Image = createLucideIcon("Image", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", ry: "2", key: "1m3agn" }],
  ["circle", { cx: "9", cy: "9", r: "2", key: "af1f0g" }],
  ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21", key: "1xmnt7" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Layers = createLucideIcon("Layers", [
  [
    "path",
    {
      d: "m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z",
      key: "8b97xw"
    }
  ],
  ["path", { d: "m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65", key: "dd6zsq" }],
  ["path", { d: "m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65", key: "ep9fru" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const LoaderCircle = createLucideIcon("LoaderCircle", [
  ["path", { d: "M21 12a9 9 0 1 1-6.219-8.56", key: "13zald" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const MessageSquare = createLucideIcon("MessageSquare", [
  ["path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", key: "1lielz" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Paperclip = createLucideIcon("Paperclip", [
  [
    "path",
    {
      d: "m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48",
      key: "1u3ebp"
    }
  ]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const RefreshCw = createLucideIcon("RefreshCw", [
  ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", key: "v9h5vc" }],
  ["path", { d: "M21 3v5h-5", key: "1q7to0" }],
  ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", key: "3uifl3" }],
  ["path", { d: "M8 16H3v5", key: "1cv678" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Search = createLucideIcon("Search", [
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }],
  ["path", { d: "m21 21-4.3-4.3", key: "1qie3q" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Terminal = createLucideIcon("Terminal", [
  ["polyline", { points: "4 17 10 11 4 5", key: "akl6gq" }],
  ["line", { x1: "12", x2: "20", y1: "19", y2: "19", key: "q2wloq" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const UserCheck = createLucideIcon("UserCheck", [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "1yyitq" }],
  ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }],
  ["polyline", { points: "16 11 18 13 22 9", key: "1pwet4" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Users = createLucideIcon("Users", [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "1yyitq" }],
  ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }],
  ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87", key: "kshegd" }],
  ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75", key: "1da9ce" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const X = createLucideIcon("X", [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
]);
const ALLOWED = {
  P: "p",
  BR: "br",
  B: "strong",
  STRONG: "strong",
  I: "em",
  EM: "em",
  U: "u",
  S: "s",
  SPAN: "span",
  DIV: "div",
  UL: "ul",
  OL: "ol",
  LI: "li",
  CODE: "code",
  PRE: "pre",
  BLOCKQUOTE: "blockquote",
  H1: "h4",
  H2: "h4",
  H3: "h5",
  H4: "h5",
  H5: "h6",
  H6: "h6",
  TABLE: "table",
  THEAD: "thead",
  TBODY: "tbody",
  TR: "tr",
  TD: "td",
  TH: "th",
  HR: "hr"
};
function safeHref(href) {
  if (!href) return null;
  const v = href.trim();
  if (/^https?:\/\//i.test(v) || v.startsWith("#")) return v;
  return null;
}
function walk(node, keyPrefix, onLink) {
  const out = [];
  let i = 0;
  for (const child of Array.from(node.childNodes)) {
    const key = `${keyPrefix}-${i++}`;
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text) out.push(text);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child;
    const tag = el.tagName.toUpperCase();
    const children = walk(el, key, onLink);
    if (tag === "A") {
      const href = safeHref(el.getAttribute("href"));
      if (href) {
        out.push(
          createElement(
            "a",
            {
              key,
              href,
              onClick: (e) => {
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
        mapped === "br" || mapped === "hr" ? createElement(mapped, { key }) : createElement(mapped, { key }, ...children)
      );
    } else {
      out.push(...children);
    }
  }
  return out;
}
function renderRichText(html, onLink) {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return walk(doc.body, "rt", onLink);
}
function typeIcon$1(type, size = 14) {
  const t = (type ?? "").toLowerCase();
  if (t === "bug") return /* @__PURE__ */ jsx(Bug, { size, "aria-hidden": true });
  if (t.includes("story")) return /* @__PURE__ */ jsx(BookOpen, { size, "aria-hidden": true });
  return /* @__PURE__ */ jsx(CircleDot, { size, "aria-hidden": true });
}
function fmtDate(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleDateString(void 0, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}
function fmtDateTime(iso) {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleString(void 0, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
const IMAGE_EXTS = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic"]);
const VIDEO_EXTS = /* @__PURE__ */ new Set(["mp4", "mov", "webm", "avi", "mkv", "m4v"]);
function fileIcon(ext) {
  const e = (ext ?? "").toLowerCase();
  if (IMAGE_EXTS.has(e)) return /* @__PURE__ */ jsx(Image, { size: 14, "aria-hidden": true });
  if (VIDEO_EXTS.has(e)) return /* @__PURE__ */ jsx(Film, { size: 14, "aria-hidden": true });
  return /* @__PURE__ */ jsx(FileText, { size: 14, "aria-hidden": true });
}
function fmtSize(bytes) {
  if (typeof bytes !== "number" || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((p) => {
    var _a;
    return ((_a = p[0]) == null ? void 0 : _a.toUpperCase()) ?? "";
  }).join("");
}
function htmlToText(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}
function buildLaunchPrompt(d) {
  const lines = [`Work GUS ${d.type ?? "work item"} ${d.name}: ${d.subject}`];
  const meta = [
    d.status && `Status: ${d.status}`,
    d.priority && `Priority: ${d.priority}`,
    d.teamName && `Team: ${d.teamName}`,
    d.productTag && `Product: ${d.productTag}`,
    d.assignee && `Assignee: ${d.assignee}`
  ].filter(Boolean);
  if (meta.length > 0) lines.push(meta.join(" · "));
  const details = htmlToText(d.detailsHtml);
  if (details) lines.push("", "Details:", details);
  lines.push(
    "",
    "Investigate this work item and help me resolve it. Start by summarizing what it asks for."
  );
  return lines.join("\n");
}
function GusDetailModal({ host, item, instanceUrl, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chatter, setChatter] = useState(null);
  const [chatterLoading, setChatterLoading] = useState(true);
  const [files, setFiles] = useState(null);
  const [filesLoading, setFilesLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    host.call("getWork", item.id).then((d2) => {
      if (live) setDetail(d2);
    }).catch((err) => {
      if (live) setError(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [host, item.id]);
  useEffect(() => {
    let live = true;
    setChatterLoading(true);
    host.call("getChatter", item.id).then((posts) => {
      if (live) setChatter(posts);
    }).catch(() => {
      if (live) setChatter([]);
    }).finally(() => {
      if (live) setChatterLoading(false);
    });
    return () => {
      live = false;
    };
  }, [host, item.id]);
  useEffect(() => {
    let live = true;
    setFilesLoading(true);
    host.call("getFiles", item.id).then((fs) => {
      if (live) setFiles(fs);
    }).catch(() => {
      if (live) setFiles([]);
    }).finally(() => {
      if (live) setFilesLoading(false);
    });
    return () => {
      live = false;
    };
  }, [host, item.id]);
  const url = `${instanceUrl}/${item.id}`;
  const openInGus = () => host.openExternal(url);
  const openFile = (fileId) => host.openExternal(`${instanceUrl}/${fileId}`);
  const d = { ...item, ...detail ?? {} };
  const launchClaude = async () => {
    const project = host.getActiveProject();
    if (!project) {
      host.toast("Open a project to launch Claude.", "error");
      return;
    }
    setLaunching(true);
    try {
      const res = await host.launchSession({
        projectId: project.id,
        cwd: project.path,
        title: `Claude: ${d.name}`,
        extraArgs: [buildLaunchPrompt(d)]
      });
      if (res) {
        host.toast(`Launched Claude for ${d.name}`);
        onClose();
      } else {
        host.toast("Couldn't launch Claude.", "error");
      }
    } catch (err) {
      host.toast(
        `Couldn't launch Claude — ${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    } finally {
      setLaunching(false);
    }
  };
  const facts = [
    ["Status", d.status],
    ["Priority", d.priority],
    ["Type", d.type],
    ["Points", typeof d.storyPoints === "number" ? String(d.storyPoints) : void 0],
    ["Sprint", d.sprintName],
    ["Team", d.teamName],
    ["Product", d.productTag],
    ["Epic", d.epicName],
    ["Assignee", d.assignee],
    ["QA", d.qaEngineer],
    ["Scheduled build", d.scheduledBuild],
    ["Found in build", d.foundInBuild],
    ["Created", fmtDate(d.createdDate)],
    ["Modified", fmtDate(d.lastModified)]
  ];
  const shownFacts = facts.filter(([, v]) => v);
  return /* @__PURE__ */ jsx("div", { className: "palette-backdrop", onMouseDown: onClose, children: /* @__PURE__ */ jsxs(
    "div",
    {
      className: "gus-modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": `${item.name} ${item.subject}`,
      onMouseDown: (e) => e.stopPropagation(),
      children: [
        /* @__PURE__ */ jsxs("header", { className: "gus-modal-header", children: [
          /* @__PURE__ */ jsxs("div", { className: "gus-modal-title", children: [
            /* @__PURE__ */ jsxs("span", { className: `gus-card-type gus-card-type--${(d.type ?? "other").toLowerCase().replace(/\s+/g, "-")}`, children: [
              typeIcon$1(d.type),
              /* @__PURE__ */ jsx("span", { children: d.name })
            ] }),
            d.priority && /* @__PURE__ */ jsx("span", { className: `gus-prio gus-prio--${d.priority.toLowerCase()}`, children: d.priority })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "gus-modal-header-actions", children: [
            /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                className: "gus-launch-btn",
                onClick: launchClaude,
                disabled: launching,
                children: [
                  launching ? /* @__PURE__ */ jsx(LoaderCircle, { size: 13, className: "gus-spin" }) : /* @__PURE__ */ jsx(Terminal, { size: 13 }),
                  /* @__PURE__ */ jsx("span", { children: "Launch Claude" })
                ]
              }
            ),
            /* @__PURE__ */ jsxs("button", { type: "button", className: "gus-open-btn", onClick: openInGus, children: [
              /* @__PURE__ */ jsx(ExternalLink, { size: 13 }),
              /* @__PURE__ */ jsx("span", { children: "Open in GUS" })
            ] }),
            /* @__PURE__ */ jsx("button", { type: "button", className: "icon-btn", "aria-label": "Close", onClick: onClose, children: /* @__PURE__ */ jsx(X, { size: 14 }) })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "gus-modal-body", children: [
          /* @__PURE__ */ jsx("h3", { className: "gus-modal-subject", children: d.subject }),
          /* @__PURE__ */ jsx("dl", { className: "gus-facts", children: shownFacts.map(([k, v]) => /* @__PURE__ */ jsxs("div", { className: "gus-fact", children: [
            /* @__PURE__ */ jsx("dt", { children: k }),
            /* @__PURE__ */ jsx("dd", { children: v })
          ] }, k)) }),
          /* @__PURE__ */ jsxs("div", { className: "gus-modal-details", children: [
            /* @__PURE__ */ jsx("div", { className: "gus-modal-section-label", children: "Details" }),
            loading && /* @__PURE__ */ jsxs("div", { className: "gus-modal-loading", children: [
              /* @__PURE__ */ jsx(LoaderCircle, { size: 14, className: "gus-spin" }),
              " Loading details…"
            ] }),
            error && /* @__PURE__ */ jsx("div", { className: "gus-modal-error", children: error }),
            !loading && !error && d.detailsHtml && /* @__PURE__ */ jsx("div", { className: "gus-richtext", children: renderRichText(d.detailsHtml, (link) => host.openExternal(link)) }),
            !loading && !error && !d.detailsHtml && /* @__PURE__ */ jsx("div", { className: "gus-modal-empty", children: "No description." })
          ] }),
          (filesLoading || files && files.length > 0) && /* @__PURE__ */ jsxs("div", { className: "gus-modal-files", children: [
            /* @__PURE__ */ jsxs("div", { className: "gus-modal-section-label", children: [
              /* @__PURE__ */ jsx(Paperclip, { size: 12, "aria-hidden": true }),
              " Attached files",
              files && files.length > 0 && /* @__PURE__ */ jsx("span", { className: "gus-chatter-count", children: files.length })
            ] }),
            filesLoading && /* @__PURE__ */ jsxs("div", { className: "gus-modal-loading", children: [
              /* @__PURE__ */ jsx(LoaderCircle, { size: 14, className: "gus-spin" }),
              " Loading files…"
            ] }),
            !filesLoading && files && files.length > 0 && /* @__PURE__ */ jsx("ul", { className: "gus-file-list", children: files.map((f) => /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                className: "gus-file",
                onClick: () => openFile(f.id),
                title: `${f.title}${f.ext ? "." + f.ext : ""} — open in GUS`,
                children: [
                  /* @__PURE__ */ jsx("span", { className: "gus-file-icon", children: fileIcon(f.ext) }),
                  /* @__PURE__ */ jsxs("span", { className: "gus-file-name", children: [
                    f.title,
                    f.ext ? `.${f.ext}` : ""
                  ] }),
                  /* @__PURE__ */ jsxs("span", { className: "gus-file-meta", children: [
                    fmtSize(f.size),
                    /* @__PURE__ */ jsx(ExternalLink, { size: 11, "aria-hidden": true })
                  ] })
                ]
              }
            ) }, f.id)) })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "gus-modal-chatter", children: [
            /* @__PURE__ */ jsxs("div", { className: "gus-modal-section-label", children: [
              /* @__PURE__ */ jsx(MessageSquare, { size: 12, "aria-hidden": true }),
              " Chatter",
              chatter && chatter.length > 0 && /* @__PURE__ */ jsx("span", { className: "gus-chatter-count", children: chatter.length })
            ] }),
            chatterLoading && /* @__PURE__ */ jsxs("div", { className: "gus-modal-loading", children: [
              /* @__PURE__ */ jsx(LoaderCircle, { size: 14, className: "gus-spin" }),
              " Loading chatter…"
            ] }),
            !chatterLoading && chatter && chatter.length === 0 && /* @__PURE__ */ jsx("div", { className: "gus-modal-empty", children: "No comments." }),
            !chatterLoading && chatter && chatter.length > 0 && /* @__PURE__ */ jsx("ul", { className: "gus-chatter-list", children: chatter.map((post) => /* @__PURE__ */ jsxs("li", { className: "gus-chatter-post", children: [
              /* @__PURE__ */ jsx("div", { className: "gus-chatter-avatar", "aria-hidden": true, children: initials(post.author) }),
              /* @__PURE__ */ jsxs("div", { className: "gus-chatter-main", children: [
                /* @__PURE__ */ jsxs("div", { className: "gus-chatter-head", children: [
                  /* @__PURE__ */ jsx("span", { className: "gus-chatter-author", children: post.author }),
                  /* @__PURE__ */ jsx("span", { className: "gus-chatter-time", children: fmtDateTime(post.createdDate) })
                ] }),
                /* @__PURE__ */ jsx("div", { className: "gus-chatter-body", children: post.body })
              ] })
            ] }, post.id)) })
          ] })
        ] })
      ]
    }
  ) });
}
const OTHER_COLUMN_KEY = "other";
const BOARD_COLUMNS = [
  { key: "new", title: "New", status: "New", droppable: true },
  { key: "in-progress", title: "In Progress", status: "In Progress", droppable: true },
  { key: "review", title: "Ready for Review", status: "Ready for Review", droppable: true },
  { key: "fixed", title: "Fixed", status: "Fixed", droppable: true },
  { key: "qa", title: "QA In Progress", status: "QA In Progress", droppable: true },
  { key: "completed", title: "Completed", status: "Completed", droppable: true },
  { key: "closed", title: "Closed", status: "Closed", droppable: false }
];
const OTHER_COLUMN = {
  key: OTHER_COLUMN_KEY,
  title: "Other",
  status: null,
  droppable: false
};
const STATUS_TO_KEY = new Map(
  BOARD_COLUMNS.filter((c) => c.status).map((c) => [c.status.toLowerCase(), c.key])
);
function columnKeyForStatus(status) {
  return STATUS_TO_KEY.get(status.trim().toLowerCase()) ?? OTHER_COLUMN_KEY;
}
const BACKLOG_UNPRIORITIZED_KEY = "prio-none";
const BACKLOG_COLUMNS = [
  { key: "prio-p0", title: "P0", status: null, droppable: false },
  { key: "prio-p1", title: "P1", status: null, droppable: false },
  { key: "prio-p2", title: "P2", status: null, droppable: false },
  { key: "prio-p3", title: "P3", status: null, droppable: false },
  { key: "prio-p4", title: "P4", status: null, droppable: false },
  { key: BACKLOG_UNPRIORITIZED_KEY, title: "Unprioritized", status: null, droppable: false }
];
const PRIORITY_TO_KEY = /* @__PURE__ */ new Map([
  ["p0", "prio-p0"],
  ["p1", "prio-p1"],
  ["p2", "prio-p2"],
  ["p3", "prio-p3"],
  ["p4", "prio-p4"]
]);
function backlogColumnKeyForPriority(priority) {
  if (!priority) return BACKLOG_UNPRIORITIZED_KEY;
  return PRIORITY_TO_KEY.get(priority.trim().toLowerCase()) ?? BACKLOG_UNPRIORITIZED_KEY;
}
const STORAGE_SPRINT_KEY = "selectedSprintId";
const STORAGE_MODE_KEY = "boardMode";
const STORAGE_TEAM_KEY = "selectedTeamId";
const UNDO_WINDOW_MS = 6e3;
let cache = null;
const CACHE_FRESH_MS = 6e4;
function isCurrentSprint(s, today) {
  if (!s.startDate || !s.endDate) return false;
  return s.startDate <= today && today <= s.endDate;
}
function GusPanel({ host }) {
  const [identity, setIdentity] = useState((cache == null ? void 0 : cache.identity) ?? null);
  const [items, setItems] = useState((cache == null ? void 0 : cache.items) ?? []);
  const [sprints, setSprints] = useState((cache == null ? void 0 : cache.sprints) ?? []);
  const [sprintSel, setSprintSel] = useState((cache == null ? void 0 : cache.sprintSel) ?? "all");
  const [mode, setMode] = useState((cache == null ? void 0 : cache.mode) ?? "work");
  const [teams, setTeams] = useState((cache == null ? void 0 : cache.teams) ?? []);
  const [teamSel, setTeamSel] = useState((cache == null ? void 0 : cache.teamSel) ?? null);
  const [typeSel, setTypeSel] = useState(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [includeClosed, setIncludeClosed] = useState((cache == null ? void 0 : cache.includeClosed) ?? false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState(null);
  const [hydrated, setHydrated] = useState(!!cache);
  const [selected, setSelected] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const undoTimers = useRef(/* @__PURE__ */ new Map());
  const boardRef = useRef(null);
  const autoScroll = useRef({
    raf: 0,
    dir: 0,
    speed: 0
  });
  const stopAutoScroll = useCallback(() => {
    if (autoScroll.current.raf) {
      cancelAnimationFrame(autoScroll.current.raf);
      autoScroll.current.raf = 0;
    }
    autoScroll.current.dir = 0;
  }, []);
  const handleBoardDragOver = useCallback((e) => {
    const el = boardRef.current;
    if (!el || !e.dataTransfer.types.includes("text/gus-id")) return;
    const EDGE = 80;
    const MAX_SPEED = 22;
    const rect = el.getBoundingClientRect();
    const x = e.clientX;
    let dir = 0;
    let speed = 0;
    if (x < rect.left + EDGE) {
      dir = -1;
      speed = (rect.left + EDGE - x) / EDGE * MAX_SPEED;
    } else if (x > rect.right - EDGE) {
      dir = 1;
      speed = (x - (rect.right - EDGE)) / EDGE * MAX_SPEED;
    }
    autoScroll.current.dir = dir;
    autoScroll.current.speed = Math.min(MAX_SPEED, Math.max(0, speed));
    if (dir === 0) {
      if (autoScroll.current.raf) {
        cancelAnimationFrame(autoScroll.current.raf);
        autoScroll.current.raf = 0;
      }
      return;
    }
    if (!autoScroll.current.raf) {
      const step = () => {
        const s = autoScroll.current;
        if (s.dir === 0 || !boardRef.current) {
          s.raf = 0;
          return;
        }
        boardRef.current.scrollLeft += s.dir * s.speed;
        s.raf = requestAnimationFrame(step);
      };
      autoScroll.current.raf = requestAnimationFrame(step);
    }
  }, []);
  const today = useMemo(() => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), []);
  const currentSprint = useMemo(
    () => sprints.find((s) => isCurrentSprint(s, today)) ?? null,
    [sprints, today]
  );
  useEffect(() => {
    if (hydrated) return;
    let live = true;
    Promise.all([
      host.storage.get(STORAGE_MODE_KEY),
      host.storage.get(STORAGE_SPRINT_KEY),
      host.storage.get(STORAGE_TEAM_KEY)
    ]).then(([savedMode, savedSprint, savedTeam]) => {
      if (!live) return;
      if (savedMode === "backlog") setMode("backlog");
      if (savedSprint) setSprintSel(savedSprint);
      if (savedTeam) setTeamSel(savedTeam);
      setHydrated(true);
    });
    return () => {
      live = false;
    };
  }, [host]);
  const effectiveSprintId = useMemo(() => {
    if (sprintSel === "all") return void 0;
    if (sprintSel === "current") return currentSprint == null ? void 0 : currentSprint.id;
    return sprintSel;
  }, [sprintSel, currentSprint]);
  const loadKey = useMemo(
    () => mode === "backlog" ? `backlog|${teamSel ?? ""}|${includeClosed}` : `work|${effectiveSprintId ?? "all"}|${includeClosed}`,
    [mode, teamSel, includeClosed, effectiveSprintId]
  );
  const load = useCallback(async () => {
    var _a;
    setLoading(true);
    setError(null);
    try {
      const [who, sp, tm] = await Promise.all([
        host.call("whoami"),
        host.call("listSprints"),
        host.call("listTeams")
      ]);
      setIdentity(who);
      setSprints(sp);
      setTeams(tm);
      let nextItems;
      let resolvedTeamId = teamSel;
      let resolvedKey;
      if (mode === "backlog") {
        const team = tm.find((t) => t.id === teamSel) ?? tm[0] ?? null;
        if (!team) {
          setItems([]);
          setError(null);
          return;
        }
        resolvedTeamId = team.id;
        if (team.id !== teamSel) setTeamSel(team.id);
        nextItems = await host.call("listBacklog", {
          teamId: team.id,
          includeClosed
        });
        setItems(nextItems);
        resolvedKey = `backlog|${team.id}|${includeClosed}`;
      } else {
        const sprintId = sprintSel === "all" ? void 0 : sprintSel === "current" ? (_a = sp.find((s) => isCurrentSprint(s, today))) == null ? void 0 : _a.id : sprintSel;
        nextItems = await host.call("listWork", {
          includeClosed,
          sprintId
        });
        setItems(nextItems);
        resolvedKey = `work|${sprintId ?? "all"}|${includeClosed}`;
      }
      cache = {
        mode,
        sprintSel,
        teamSel: resolvedTeamId,
        includeClosed,
        identity: who,
        sprints: sp,
        teams: tm,
        items: nextItems,
        loadKey: resolvedKey,
        loadedAt: Date.now()
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [host, mode, sprintSel, teamSel, includeClosed, effectiveSprintId, loadKey]);
  useEffect(() => {
    if (!hydrated) return;
    if (cache && cache.loadKey === loadKey && Date.now() - cache.loadedAt < CACHE_FRESH_MS) {
      return;
    }
    void load();
  }, [hydrated, loadKey, load]);
  useEffect(() => {
    if (cache && cache.loadKey === loadKey) cache.items = items;
  }, [items, loadKey]);
  const selectSprint = (value) => {
    setSprintSel(value);
    void host.storage.set(STORAGE_SPRINT_KEY, value === "all" ? "" : value);
  };
  const selectMode = (value) => {
    setMode(value);
    setTypeSel(null);
    setMineOnly(false);
    void host.storage.set(STORAGE_MODE_KEY, value);
  };
  const selectTeam = (id) => {
    setTeamSel(id);
    setTypeSel(null);
    void host.storage.set(STORAGE_TEAM_KEY, id);
  };
  const instanceUrl = (identity == null ? void 0 : identity.instanceUrl) ?? "https://gus.my.salesforce.com";
  const openItem = (item) => setSelected(item);
  const patchStatus = useCallback((id, status) => {
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, status } : it));
  }, []);
  const commitStatus = useCallback(
    (id, name, fromStatus, toStatus) => {
      const timer = window.setTimeout(() => {
        undoTimers.current.delete(id);
        host.call("setStatus", id, toStatus).catch((err) => {
          patchStatus(id, fromStatus);
          host.toast(
            `${name}: couldn't set status — ${err instanceof Error ? err.message : String(err)}`,
            "error"
          );
        });
      }, UNDO_WINDOW_MS);
      undoTimers.current.set(id, timer);
    },
    [host, patchStatus]
  );
  const undoMove = useCallback(
    (id, fromStatus) => {
      const t = undoTimers.current.get(id);
      if (t) {
        window.clearTimeout(t);
        undoTimers.current.delete(id);
      }
      patchStatus(id, fromStatus);
    },
    [patchStatus]
  );
  const handleDrop = useCallback(
    (col, id) => {
      setDragOverKey(null);
      setDraggingId(null);
      if (!col.droppable || !col.status) return;
      const item = items.find((it) => it.id === id);
      if (!item || item.status === col.status) return;
      const fromStatus = item.status;
      const toStatus = col.status;
      patchStatus(id, toStatus);
      commitStatus(id, item.name, fromStatus, toStatus);
      setUndo({ id, name: item.name, fromStatus, toStatus });
    },
    [items, patchStatus, commitStatus]
  );
  const [undo, setUndo] = useState(null);
  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => window.clearTimeout(t);
  }, [undo]);
  useEffect(() => {
    const timers = undoTimers.current;
    return () => {
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
      stopAutoScroll();
    };
  }, [stopAutoScroll]);
  const backlogBase = useMemo(() => {
    if (mode !== "backlog" || !mineOnly || !identity) return items;
    return items.filter((it) => it.assigneeId === identity.userId);
  }, [items, mode, mineOnly, identity]);
  const typeCounts = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    for (const it of backlogBase) {
      const t = it.type ?? "Other";
      map.set(t, (map.get(t) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
  }, [backlogBase]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byType = mode === "backlog" && typeSel;
    if (!q && !byType) return backlogBase;
    return backlogBase.filter((it) => {
      if (byType && (it.type ?? "Other") !== typeSel) return false;
      if (!q) return true;
      return it.subject.toLowerCase().includes(q) || it.name.toLowerCase().includes(q) || (it.epicName ?? "").toLowerCase().includes(q) || (it.productTag ?? "").toLowerCase().includes(q);
    });
  }, [backlogBase, query, mode, typeSel]);
  const byColumn = useMemo(() => {
    const map = {};
    for (const it of filtered) {
      const key = mode === "backlog" ? backlogColumnKeyForPriority(it.priority) : columnKeyForStatus(it.status);
      (map[key] ?? (map[key] = [])).push(it);
    }
    return map;
  }, [filtered, mode]);
  const columns = useMemo(() => {
    if (mode === "backlog") return BACKLOG_COLUMNS;
    const base = BOARD_COLUMNS.filter((c) => c.key !== "closed" || includeClosed);
    const otherCount = (byColumn[OTHER_COLUMN_KEY] ?? []).length;
    return otherCount > 0 ? [...base, OTHER_COLUMN] : base;
  }, [mode, includeClosed, byColumn]);
  const totalShown = filtered.length;
  const activeTeam = useMemo(
    () => mode === "backlog" ? teams.find((t) => t.id === teamSel) ?? null : null,
    [mode, teams, teamSel]
  );
  return /* @__PURE__ */ jsxs("section", { className: "gus-panel", children: [
    /* @__PURE__ */ jsxs("header", { className: "gus-header", children: [
      /* @__PURE__ */ jsxs("div", { className: "gus-header-title", children: [
        /* @__PURE__ */ jsx(Layers, { size: 16, className: "gus-header-icon", "aria-hidden": true }),
        /* @__PURE__ */ jsx("h2", { children: "GUS" }),
        mode === "backlog" ? activeTeam && /* @__PURE__ */ jsxs("span", { className: "gus-user", children: [
          activeTeam.name,
          " backlog"
        ] }) : identity && /* @__PURE__ */ jsx("span", { className: "gus-user", children: identity.username })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "gus-header-actions", children: [
        /* @__PURE__ */ jsxs("span", { className: "gus-count-pill", children: [
          totalShown,
          " ",
          totalShown === 1 ? "item" : "items"
        ] }),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            className: "icon-btn",
            onClick: () => void load(),
            disabled: loading,
            title: "Refresh",
            "aria-label": "Refresh",
            children: /* @__PURE__ */ jsx(RefreshCw, { size: 14, className: loading ? "gus-spin" : void 0 })
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "gus-body", children: [
      /* @__PURE__ */ jsxs("aside", { className: "gus-rail", children: [
        /* @__PURE__ */ jsxs("div", { className: "gus-search", children: [
          /* @__PURE__ */ jsx(Search, { size: 13, className: "gus-search-icon", "aria-hidden": true }),
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "text",
              placeholder: "Filter work…",
              value: query,
              onChange: (e) => setQuery(e.target.value)
            }
          ),
          query && /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "gus-search-clear",
              "aria-label": "Clear filter",
              onClick: () => setQuery(""),
              children: /* @__PURE__ */ jsx(X, { size: 12 })
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "gus-mode-switch", role: "tablist", "aria-label": "Board mode", children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": mode === "work",
              className: `gus-mode-tab ${mode === "work" ? "active" : ""}`,
              onClick: () => selectMode("work"),
              children: "My work"
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": mode === "backlog",
              className: `gus-mode-tab ${mode === "backlog" ? "active" : ""}`,
              onClick: () => selectMode("backlog"),
              children: "Backlog"
            }
          )
        ] }),
        mode === "work" ? /* @__PURE__ */ jsxs("div", { className: "gus-rail-section", children: [
          /* @__PURE__ */ jsx("div", { className: "gus-rail-label", children: "Sprint" }),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: `gus-rail-item ${sprintSel === "all" ? "active" : ""}`,
              onClick: () => selectSprint("all"),
              children: /* @__PURE__ */ jsx("span", { className: "gus-rail-item-name", children: "All sprints" })
            }
          ),
          /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              className: `gus-rail-item ${sprintSel === "current" ? "active" : ""}`,
              onClick: () => selectSprint("current"),
              disabled: !currentSprint,
              title: currentSprint ? currentSprint.name : "No sprint covers today",
              children: [
                /* @__PURE__ */ jsx(CalendarClock, { size: 13, "aria-hidden": true }),
                /* @__PURE__ */ jsx("span", { className: "gus-rail-item-name", children: "Current sprint" }),
                currentSprint && /* @__PURE__ */ jsx("span", { className: "gus-rail-count", children: currentSprint.openCount })
              ]
            }
          ),
          /* @__PURE__ */ jsx("div", { className: "gus-rail-divider" }),
          sprints.map((s) => {
            const isCurrent = (currentSprint == null ? void 0 : currentSprint.id) === s.id;
            return /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                className: `gus-rail-item ${sprintSel === s.id ? "active" : ""}`,
                onClick: () => selectSprint(s.id),
                title: s.startDate && s.endDate ? `${s.startDate} → ${s.endDate}` : s.name,
                children: [
                  /* @__PURE__ */ jsxs("span", { className: "gus-rail-item-name", children: [
                    s.name,
                    isCurrent && /* @__PURE__ */ jsx("span", { className: "gus-now-dot", title: "Current sprint" })
                  ] }),
                  /* @__PURE__ */ jsx("span", { className: "gus-rail-count", children: s.openCount })
                ]
              },
              s.id
            );
          })
        ] }) : /* @__PURE__ */ jsxs("div", { className: "gus-rail-section", children: [
          /* @__PURE__ */ jsx("div", { className: "gus-rail-label", children: "Team" }),
          teams.length === 0 && !loading && /* @__PURE__ */ jsx("div", { className: "gus-rail-hint", children: "No teams found on your work." }),
          teams.map((t) => /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              className: `gus-rail-item ${teamSel === t.id ? "active" : ""}`,
              onClick: () => selectTeam(t.id),
              title: t.name,
              children: [
                /* @__PURE__ */ jsx(Users, { size: 13, "aria-hidden": true }),
                /* @__PURE__ */ jsx("span", { className: "gus-rail-item-name", children: t.name }),
                /* @__PURE__ */ jsx("span", { className: "gus-rail-count", title: "Your open work on this team", children: t.openCount })
              ]
            },
            t.id
          )),
          /* @__PURE__ */ jsx("div", { className: "gus-rail-divider" }),
          /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              className: `gus-rail-item ${mineOnly ? "active" : ""}`,
              onClick: () => {
                setMineOnly((v) => !v);
                setTypeSel(null);
              },
              title: "Show only backlog items assigned to you",
              children: [
                /* @__PURE__ */ jsx(UserCheck, { size: 13, "aria-hidden": true }),
                /* @__PURE__ */ jsx("span", { className: "gus-rail-item-name", children: "Assigned to me" })
              ]
            }
          ),
          typeCounts.length > 1 && /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx("div", { className: "gus-rail-divider" }),
            /* @__PURE__ */ jsx("div", { className: "gus-rail-label", children: "Type" }),
            /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                className: `gus-rail-item ${typeSel === null ? "active" : ""}`,
                onClick: () => setTypeSel(null),
                children: [
                  /* @__PURE__ */ jsx("span", { className: "gus-rail-item-name", children: "All types" }),
                  /* @__PURE__ */ jsx("span", { className: "gus-rail-count", children: backlogBase.length })
                ]
              }
            ),
            typeCounts.map(({ type, count }) => /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                className: `gus-rail-item ${typeSel === type ? "active" : ""}`,
                onClick: () => setTypeSel((cur) => cur === type ? null : type),
                title: type,
                children: [
                  /* @__PURE__ */ jsx("span", { className: "gus-rail-item-name", children: type }),
                  /* @__PURE__ */ jsx("span", { className: "gus-rail-count", children: count })
                ]
              },
              type
            ))
          ] })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "gus-toggle", title: "Include closed / rejected work", children: [
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "checkbox",
              checked: includeClosed,
              onChange: (e) => setIncludeClosed(e.target.checked)
            }
          ),
          /* @__PURE__ */ jsx("span", { children: "Show closed" })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "gus-content", children: [
        error && /* @__PURE__ */ jsxs("div", { className: "gus-error", role: "alert", children: [
          /* @__PURE__ */ jsx(CircleAlert, { size: 16 }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("strong", { children: "Couldn't load GUS work." }),
            /* @__PURE__ */ jsx("p", { children: error }),
            /* @__PURE__ */ jsxs("p", { className: "gus-error-hint", children: [
              "Make sure the Salesforce CLI is authed:",
              " ",
              /* @__PURE__ */ jsx("code", { children: "sf org login web --alias gus --instance-url https://gus.my.salesforce.com" })
            ] })
          ] })
        ] }),
        !error && /* @__PURE__ */ jsx(
          "div",
          {
            className: "gus-board",
            ref: boardRef,
            onDragOver: handleBoardDragOver,
            onDrop: stopAutoScroll,
            children: columns.map((col) => {
              const colItems = byColumn[col.key] ?? [];
              const isOver = dragOverKey === col.key;
              return /* @__PURE__ */ jsxs(
                "div",
                {
                  className: [
                    "gus-column",
                    `gus-column--${col.key}`,
                    col.droppable ? "is-droppable" : "",
                    isOver ? "is-over" : ""
                  ].filter(Boolean).join(" "),
                  onDragOver: (e) => {
                    if (!col.droppable || !draggingId) return;
                    e.preventDefault();
                    if (dragOverKey !== col.key) setDragOverKey(col.key);
                  },
                  onDragLeave: (e) => {
                    if (e.currentTarget === e.target && dragOverKey === col.key) {
                      setDragOverKey(null);
                    }
                  },
                  onDrop: (e) => {
                    const id = e.dataTransfer.getData("text/gus-id");
                    if (id) handleDrop(col, id);
                  },
                  children: [
                    /* @__PURE__ */ jsxs("div", { className: "gus-column-head", children: [
                      /* @__PURE__ */ jsx("span", { className: "gus-column-title", children: col.title }),
                      /* @__PURE__ */ jsx("span", { className: "gus-column-count", children: colItems.length })
                    ] }),
                    /* @__PURE__ */ jsxs("div", { className: "gus-column-body", children: [
                      colItems.map((item) => /* @__PURE__ */ jsx(
                        GusCard,
                        {
                          item,
                          draggable: col.droppable,
                          dragging: draggingId === item.id,
                          subjectFirst: mode === "backlog",
                          onOpen: () => openItem(item),
                          onDragStart: (e) => {
                            e.dataTransfer.setData("text/gus-id", item.id);
                            e.dataTransfer.effectAllowed = "move";
                            const id = item.id;
                            setTimeout(() => setDraggingId(id), 0);
                          },
                          onDragEnd: () => {
                            setDraggingId(null);
                            setDragOverKey(null);
                            stopAutoScroll();
                          }
                        },
                        item.id
                      )),
                      colItems.length === 0 && !loading && /* @__PURE__ */ jsx("div", { className: "gus-column-empty", children: col.droppable && draggingId ? "Drop here" : "Nothing here" })
                    ] })
                  ]
                },
                col.key
              );
            })
          }
        ),
        loading && items.length === 0 && !error && /* @__PURE__ */ jsx("div", { className: "gus-loading", children: mode === "backlog" ? "Loading the team backlog…" : "Loading your GUS work…" })
      ] })
    ] }),
    undo && /* @__PURE__ */ jsxs("div", { className: "gus-undo", role: "status", children: [
      /* @__PURE__ */ jsxs("span", { children: [
        undo.name,
        " → ",
        /* @__PURE__ */ jsx("strong", { children: undo.toStatus })
      ] }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: () => {
            undoMove(undo.id, undo.fromStatus);
            setUndo(null);
          },
          children: "Undo"
        }
      )
    ] }),
    selected && /* @__PURE__ */ jsx(
      GusDetailModal,
      {
        host,
        item: selected,
        instanceUrl,
        onClose: () => setSelected(null)
      }
    )
  ] });
}
function typeIcon(type) {
  const t = (type ?? "").toLowerCase();
  if (t === "bug") return /* @__PURE__ */ jsx(Bug, { size: 12, "aria-hidden": true });
  if (t.includes("story")) return /* @__PURE__ */ jsx(BookOpen, { size: 12, "aria-hidden": true });
  return /* @__PURE__ */ jsx(CircleDot, { size: 12, "aria-hidden": true });
}
function timeAgo(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const sec = Math.floor((Date.now() - then) / 1e3);
  if (sec < 0) return null;
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}
function GusCard({
  item,
  draggable,
  dragging,
  subjectFirst,
  onOpen,
  onDragStart,
  onDragEnd
}) {
  const typeClass = (item.type ?? "other").toLowerCase().replace(/\s+/g, "-");
  if (subjectFirst) {
    const age = timeAgo(item.lastModified);
    return /* @__PURE__ */ jsxs(
      "div",
      {
        className: `gus-card gus-card--backlog ${dragging ? "is-dragging" : ""}`,
        onClick: onOpen,
        role: "button",
        tabIndex: 0,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        },
        title: `${item.name} — click for details`,
        children: [
          /* @__PURE__ */ jsx("div", { className: "gus-card-subject gus-card-subject--lead", children: item.subject }),
          /* @__PURE__ */ jsxs("div", { className: "gus-card-foot", children: [
            /* @__PURE__ */ jsxs("span", { className: "gus-card-foot-lead", children: [
              /* @__PURE__ */ jsxs("span", { className: `gus-card-type gus-card-type--${typeClass}`, children: [
                typeIcon(item.type),
                /* @__PURE__ */ jsx("span", { children: item.name })
              ] }),
              item.author && /* @__PURE__ */ jsx("span", { className: "gus-card-author", title: `Opened by ${item.author}`, children: item.author })
            ] }),
            age && /* @__PURE__ */ jsx("span", { className: "gus-card-age", title: `Last modified ${item.lastModified ?? ""}`, children: age })
          ] })
        ]
      }
    );
  }
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: `gus-card ${dragging ? "is-dragging" : ""} ${draggable ? "is-draggable" : ""}`,
      draggable,
      onDragStart,
      onDragEnd,
      onClick: onOpen,
      role: "button",
      tabIndex: 0,
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      },
      title: `${item.name} — click for details`,
      children: [
        /* @__PURE__ */ jsxs("div", { className: "gus-card-top", children: [
          /* @__PURE__ */ jsxs("span", { className: `gus-card-type gus-card-type--${typeClass}`, children: [
            typeIcon(item.type),
            /* @__PURE__ */ jsx("span", { children: item.name })
          ] }),
          item.priority && /* @__PURE__ */ jsx("span", { className: `gus-prio gus-prio--${item.priority.toLowerCase()}`, children: item.priority })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "gus-card-subject", children: item.subject }),
        (item.sprintName || typeof item.storyPoints === "number" || item.author) && /* @__PURE__ */ jsxs("div", { className: "gus-card-meta", children: [
          item.sprintName && /* @__PURE__ */ jsx("span", { className: "gus-chip", children: item.sprintName }),
          typeof item.storyPoints === "number" && /* @__PURE__ */ jsxs("span", { className: "gus-chip gus-chip--pts", children: [
            item.storyPoints,
            " pts"
          ] }),
          item.author && /* @__PURE__ */ jsx("span", { className: "gus-chip gus-chip--author", title: `Opened by ${item.author}`, children: item.author }),
          /* @__PURE__ */ jsx(ExternalLink, { size: 11, className: "gus-card-open", "aria-hidden": true })
        ] })
      ]
    }
  );
}
const entry = {
  activate({ React, host }) {
    setHostReact(React);
    return {
      panel: GusPanel,
      // Ported verbatim from the built-in gusModule. Core namespaces this as
      // `ext:gus:say-hi`.
      commands: (h) => [
        {
          id: "say-hi",
          label: "GUS: say hi",
          keywords: ["hello", "greet", "ping"],
          run: () => h.toast("Hello from the GUS module")
        }
      ],
      // Sidebar nav badge: number of open projects (cheap + synchronous).
      navBadge: (h) => h.listProjects().length
    };
  }
};
export {
  entry as default
};
