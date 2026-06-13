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
    "cu extension: host React unavailable — the host must set globalThis." + GLOBAL_KEY + " before import, or call activate({ React })."
  );
}
const Fragment = Symbol.for("cu-ext.jsx.Fragment");
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
const Activity = createLucideIcon("Activity", [
  [
    "path",
    {
      d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
      key: "169zse"
    }
  ]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Bot = createLucideIcon("Bot", [
  ["path", { d: "M12 8V4H8", key: "hb8ula" }],
  ["rect", { width: "16", height: "12", x: "4", y: "8", rx: "2", key: "enze0r" }],
  ["path", { d: "M2 14h2", key: "vft8re" }],
  ["path", { d: "M20 14h2", key: "4cs60a" }],
  ["path", { d: "M15 13v2", key: "1xurst" }],
  ["path", { d: "M9 13v2", key: "rq6x2g" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Boxes = createLucideIcon("Boxes", [
  [
    "path",
    {
      d: "M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z",
      key: "lc1i9w"
    }
  ],
  ["path", { d: "m7 16.5-4.74-2.85", key: "1o9zyk" }],
  ["path", { d: "m7 16.5 5-3", key: "va8pkn" }],
  ["path", { d: "M7 16.5v5.17", key: "jnp8gn" }],
  [
    "path",
    {
      d: "M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z",
      key: "8zsnat"
    }
  ],
  ["path", { d: "m17 16.5-5-3", key: "8arw3v" }],
  ["path", { d: "m17 16.5 4.74-2.85", key: "8rfmw" }],
  ["path", { d: "M17 16.5v5.17", key: "k6z78m" }],
  [
    "path",
    {
      d: "M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z",
      key: "1xygjf"
    }
  ],
  ["path", { d: "M12 8 7.26 5.15", key: "1vbdud" }],
  ["path", { d: "m12 8 4.74-2.85", key: "3rx089" }],
  ["path", { d: "M12 13.5V8", key: "1io7kd" }]
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
const Clock = createLucideIcon("Clock", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["polyline", { points: "12 6 12 12 16 14", key: "68esgv" }]
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
const History = createLucideIcon("History", [
  ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", key: "1357e3" }],
  ["path", { d: "M3 3v5h5", key: "1xhq8a" }],
  ["path", { d: "M12 7v5l4 2", key: "1fdv2h" }]
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
const Pause = createLucideIcon("Pause", [
  ["rect", { x: "14", y: "4", width: "4", height: "16", rx: "1", key: "zuxfzm" }],
  ["rect", { x: "6", y: "4", width: "4", height: "16", rx: "1", key: "1okwgv" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Play = createLucideIcon("Play", [
  ["polygon", { points: "6 3 20 12 6 21 6 3", key: "1oa8hb" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const PowerOff = createLucideIcon("PowerOff", [
  ["path", { d: "M18.36 6.64A9 9 0 0 1 20.77 15", key: "dxknvb" }],
  ["path", { d: "M6.16 6.16a9 9 0 1 0 12.68 12.68", key: "1x7qb5" }],
  ["path", { d: "M12 2v4", key: "3427ic" }],
  ["path", { d: "m2 2 20 20", key: "1ooewy" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Power = createLucideIcon("Power", [
  ["path", { d: "M12 2v10", key: "mnfbl" }],
  ["path", { d: "M18.4 6.6a9 9 0 1 1-12.77.04", key: "obofu9" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Radio = createLucideIcon("Radio", [
  ["path", { d: "M4.9 19.1C1 15.2 1 8.8 4.9 4.9", key: "1vaf9d" }],
  ["path", { d: "M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5", key: "u1ii0m" }],
  ["circle", { cx: "12", cy: "12", r: "2", key: "1c9p78" }],
  ["path", { d: "M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5", key: "1j5fej" }],
  ["path", { d: "M19.1 4.9C23 8.8 23 15.1 19.1 19", key: "10b0cb" }]
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
const Rocket = createLucideIcon("Rocket", [
  [
    "path",
    {
      d: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z",
      key: "m3kijz"
    }
  ],
  [
    "path",
    {
      d: "m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",
      key: "1fmvmk"
    }
  ],
  ["path", { d: "M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0", key: "1f8sc4" }],
  ["path", { d: "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5", key: "qeys4" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const RotateCw = createLucideIcon("RotateCw", [
  ["path", { d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", key: "1p45f6" }],
  ["path", { d: "M21 3v5h-5", key: "1q7to0" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Settings2 = createLucideIcon("Settings2", [
  ["path", { d: "M20 7h-9", key: "3s1dr2" }],
  ["path", { d: "M14 17H5", key: "gfn3mx" }],
  ["circle", { cx: "17", cy: "17", r: "3", key: "18b49y" }],
  ["circle", { cx: "7", cy: "7", r: "3", key: "dfmy0x" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Square = createLucideIcon("Square", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Webhook = createLucideIcon("Webhook", [
  [
    "path",
    {
      d: "M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2",
      key: "q3hayz"
    }
  ],
  ["path", { d: "m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06", key: "1go1hn" }],
  ["path", { d: "m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8", key: "qlwsc0" }]
]);
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Workflow = createLucideIcon("Workflow", [
  ["rect", { width: "8", height: "8", x: "3", y: "3", rx: "2", key: "by2w9f" }],
  ["path", { d: "M7 11v4a2 2 0 0 0 2 2h4", key: "xkn7yn" }],
  ["rect", { width: "8", height: "8", x: "13", y: "13", rx: "2", key: "1cgmvn" }]
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
/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const Zap = createLucideIcon("Zap", [
  [
    "path",
    {
      d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
      key: "1xq2db"
    }
  ]
]);
const PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "plan",
  "dontAsk"
];
const RUNNING_STATUSES = /* @__PURE__ */ new Set(["running"]);
function isRunning(status) {
  return !!status && RUNNING_STATUSES.has(status.trim().toLowerCase());
}
function isPaused(status) {
  return !!status && status.trim().toLowerCase().startsWith("paused");
}
function isTerminal(status) {
  const s = (status ?? "").trim().toLowerCase();
  return s === "completed" || s === "failed" || s === "cancelled";
}
const RUNNING_COUNT_CACHE_KEY = "cu.runningCount";
const FLEET_CACHE_KEY = "cu.fleet";
function sessionLabel(s) {
  if (s.shortName) return s.shortName;
  return s.id.length > 12 ? `${s.id.slice(0, 12)}…` : s.id;
}
function repoBasename(repoPath) {
  if (!repoPath) return "(no repo)";
  const parts = repoPath.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || repoPath;
}
const CU_TABS = ["fleet", "profiles", "agents", "workflows", "schedules"];
function renderInline(text, keyPrefix) {
  const nodes = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(pattern)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    const tok = m[0];
    const key = `${keyPrefix}-i${i++}`;
    if (tok.startsWith("`")) {
      nodes.push(createElement("code", { key }, tok.slice(1, -1)));
    } else if (tok.startsWith("**")) {
      nodes.push(createElement("strong", { key }, tok.slice(2, -2)));
    } else {
      nodes.push(createElement("em", { key }, tok.slice(1, -1)));
    }
    last = idx + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let para = [];
  let list = null;
  let code = null;
  let key = 0;
  const flushPara = () => {
    if (para.length) {
      const text = para.join(" ");
      blocks.push(createElement("p", { key: `p${key++}` }, ...renderInline(text, `p${key}`)));
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const tag = list.ordered ? "ol" : "ul";
      const items = list.items.map(
        (it, idx) => createElement("li", { key: `li${idx}` }, ...renderInline(it, `li${key}-${idx}`))
      );
      blocks.push(createElement(tag, { key: `l${key++}` }, ...items));
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw;
    if (line.trim().startsWith("```")) {
      if (code) {
        blocks.push(
          createElement(
            "pre",
            { key: `pre${key++}`, className: "cu-code" },
            createElement("code", null, code.join("\n"))
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
      const level = Math.min(6, heading[1].length + 1);
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
      const item = (bullet ?? ordered)[1];
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(item);
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  if (code) {
    blocks.push(
      createElement(
        "pre",
        { key: `pre${key++}`, className: "cu-code" },
        createElement("code", null, code.join("\n"))
      )
    );
  }
  return createElement("div", { className: "cu-markdown-body" }, ...blocks);
}
function fmtBytes(bytes) {
  if (typeof bytes !== "number" || bytes < 0) return "—";
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
function CuPostMortemModal({ host, session, onClose }) {
  const [markdown, setMarkdown] = useState(null);
  const [pmLoading, setPmLoading] = useState(true);
  const [pmError, setPmError] = useState(null);
  const [vitals, setVitals] = useState(null);
  const [vitalsLoading, setVitalsLoading] = useState(true);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    let live = true;
    setPmLoading(true);
    setPmError(null);
    host.call("postMortem", session.id).then((pm) => {
      if (live) setMarkdown((pm == null ? void 0 : pm.markdown) ?? "");
    }).catch((err) => {
      if (live) setPmError(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (live) setPmLoading(false);
    });
    return () => {
      live = false;
    };
  }, [host, session.id]);
  useEffect(() => {
    let live = true;
    setVitalsLoading(true);
    host.call("vitals", session.id).then((v) => {
      if (live) setVitals(v ?? {});
    }).catch(() => {
      if (live) setVitals({});
    }).finally(() => {
      if (live) setVitalsLoading(false);
    });
    return () => {
      live = false;
    };
  }, [host, session.id]);
  const facts = [
    ["Status", session.status],
    ["Profile", session.profile],
    ["Model", session.model],
    ["Turns", typeof session.turns === "number" ? String(session.turns) : void 0],
    ["Cost", typeof session.costUsd === "number" ? `$${session.costUsd.toFixed(2)}` : void 0],
    ["Repo", session.repoPath]
  ];
  const shownFacts = facts.filter(([, v]) => v);
  return /* @__PURE__ */ jsx("div", { className: "palette-backdrop", onMouseDown: onClose, children: /* @__PURE__ */ jsxs(
    "div",
    {
      className: "cu-modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": `Post-mortem for ${sessionLabel(session)}`,
      onMouseDown: (e) => e.stopPropagation(),
      children: [
        /* @__PURE__ */ jsxs("header", { className: "cu-modal-header", children: [
          /* @__PURE__ */ jsxs("div", { className: "cu-modal-title", children: [
            /* @__PURE__ */ jsx(FileText, { size: 14, "aria-hidden": true }),
            /* @__PURE__ */ jsx("span", { children: sessionLabel(session) })
          ] }),
          /* @__PURE__ */ jsx("button", { type: "button", className: "icon-btn", "aria-label": "Close", onClick: onClose, children: /* @__PURE__ */ jsx(X, { size: 14 }) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "cu-modal-body", children: [
          /* @__PURE__ */ jsx("dl", { className: "cu-facts", children: shownFacts.map(([k, v]) => /* @__PURE__ */ jsxs("div", { className: "cu-fact", children: [
            /* @__PURE__ */ jsx("dt", { children: k }),
            /* @__PURE__ */ jsx("dd", { children: v })
          ] }, k)) }),
          /* @__PURE__ */ jsxs("div", { className: "cu-modal-section", children: [
            /* @__PURE__ */ jsxs("div", { className: "cu-modal-section-label", children: [
              /* @__PURE__ */ jsx(Activity, { size: 12, "aria-hidden": true }),
              " Vitals"
            ] }),
            vitalsLoading ? /* @__PURE__ */ jsxs("div", { className: "cu-modal-loading", children: [
              /* @__PURE__ */ jsx(LoaderCircle, { size: 14, className: "cu-spin" }),
              " Loading vitals…"
            ] }) : /* @__PURE__ */ jsxs("div", { className: "cu-vitals", children: [
              /* @__PURE__ */ jsxs("span", { className: "cu-chip", children: [
                "PID ",
                (vitals == null ? void 0 : vitals.pid) ?? "—"
              ] }),
              /* @__PURE__ */ jsxs("span", { className: "cu-chip", children: [
                "RSS ",
                fmtBytes(vitals == null ? void 0 : vitals.rss)
              ] }),
              /* @__PURE__ */ jsxs("span", { className: "cu-chip", children: [
                "CPU ",
                typeof (vitals == null ? void 0 : vitals.cpu) === "number" ? `${vitals.cpu.toFixed(0)}%` : "—"
              ] })
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "cu-modal-section", children: [
            /* @__PURE__ */ jsx("div", { className: "cu-modal-section-label", children: "Post-mortem" }),
            pmLoading && /* @__PURE__ */ jsxs("div", { className: "cu-modal-loading", children: [
              /* @__PURE__ */ jsx(LoaderCircle, { size: 14, className: "cu-spin" }),
              " Loading post-mortem…"
            ] }),
            pmError && /* @__PURE__ */ jsx("div", { className: "cu-modal-error", children: pmError }),
            !pmLoading && !pmError && markdown && /* @__PURE__ */ jsx("div", { className: "cu-markdown", children: renderMarkdown(markdown) }),
            !pmLoading && !pmError && !markdown && /* @__PURE__ */ jsx("div", { className: "cu-modal-empty", children: "No post-mortem available." })
          ] })
        ] })
      ]
    }
  ) });
}
function CuLaunchModal({ host, onClose, onLaunched }) {
  var _a;
  const projects = useMemo(() => host.listProjects(), [host]);
  const active = useMemo(() => host.getActiveProject(), [host]);
  const [repoPath, setRepoPath] = useState((active == null ? void 0 : active.path) ?? ((_a = projects[0]) == null ? void 0 : _a.path) ?? "");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [profile, setProfile] = useState("");
  const [agent, setAgent] = useState("");
  const [maxTurns, setMaxTurns] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [permissionMode, setPermissionMode] = useState("");
  const [allowedTools, setAllowedTools] = useState("");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !launching) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, launching]);
  const canLaunch = repoPath.trim() && prompt.trim() && !launching;
  const submit = async () => {
    if (!canLaunch) return;
    setLaunching(true);
    setError(null);
    const opts = {
      repoPath: repoPath.trim(),
      prompt: prompt.trim(),
      model: model.trim() || void 0,
      profile: profile.trim() || void 0,
      agent: agent.trim() || void 0,
      maxTurns: maxTurns.trim() ? Number(maxTurns) : void 0,
      maxBudgetUsd: maxBudget.trim() ? Number(maxBudget) : void 0,
      permissionMode: permissionMode || void 0,
      allowedTools: allowedTools.trim() || void 0
    };
    try {
      const res = await host.call("run", opts);
      const label = (res == null ? void 0 : res.shortName) || (res == null ? void 0 : res.sessionId) || "session";
      host.toast(`Launched ${label}.`);
      onLaunched();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      host.toast(`Couldn't launch — ${msg}`, "error");
    } finally {
      setLaunching(false);
    }
  };
  return /* @__PURE__ */ jsx("div", { className: "palette-backdrop", onMouseDown: () => !launching && onClose(), children: /* @__PURE__ */ jsxs(
    "div",
    {
      className: "cu-modal cu-launch-modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Launch a Claude Unleashed session",
      onMouseDown: (e) => e.stopPropagation(),
      children: [
        /* @__PURE__ */ jsxs("header", { className: "cu-modal-header", children: [
          /* @__PURE__ */ jsxs("div", { className: "cu-modal-title", children: [
            /* @__PURE__ */ jsx(Rocket, { size: 14, "aria-hidden": true }),
            /* @__PURE__ */ jsx("span", { children: "Launch session" })
          ] }),
          /* @__PURE__ */ jsx("button", { type: "button", className: "icon-btn", "aria-label": "Close", onClick: onClose, children: /* @__PURE__ */ jsx(X, { size: 14 }) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "cu-modal-body cu-form", children: [
          /* @__PURE__ */ jsxs("label", { className: "cu-field", children: [
            /* @__PURE__ */ jsx("span", { className: "cu-field-label", children: "Repo" }),
            projects.length > 0 ? /* @__PURE__ */ jsxs("select", { value: repoPath, onChange: (e) => setRepoPath(e.target.value), children: [
              projects.map((p) => /* @__PURE__ */ jsxs("option", { value: p.path, children: [
                p.name,
                " — ",
                p.path
              ] }, p.id)),
              !projects.some((p) => p.path === repoPath) && repoPath && /* @__PURE__ */ jsx("option", { value: repoPath, children: repoPath })
            ] }) : /* @__PURE__ */ jsx(
              "input",
              {
                type: "text",
                value: repoPath,
                placeholder: "/path/to/repo",
                onChange: (e) => setRepoPath(e.target.value)
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("label", { className: "cu-field", children: [
            /* @__PURE__ */ jsx("span", { className: "cu-field-label", children: "Prompt" }),
            /* @__PURE__ */ jsx(
              "textarea",
              {
                rows: 4,
                value: prompt,
                placeholder: "What should the session do?",
                onChange: (e) => setPrompt(e.target.value)
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "cu-field-row", children: [
            /* @__PURE__ */ jsxs("label", { className: "cu-field", children: [
              /* @__PURE__ */ jsx("span", { className: "cu-field-label", children: "Model" }),
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "text",
                  value: model,
                  placeholder: "(default)",
                  onChange: (e) => setModel(e.target.value)
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "cu-field", children: [
              /* @__PURE__ */ jsx("span", { className: "cu-field-label", children: "Profile" }),
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "text",
                  value: profile,
                  placeholder: "(none)",
                  onChange: (e) => setProfile(e.target.value)
                }
              )
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "cu-field-row", children: [
            /* @__PURE__ */ jsxs("label", { className: "cu-field", children: [
              /* @__PURE__ */ jsx("span", { className: "cu-field-label", children: "Agent" }),
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "text",
                  value: agent,
                  placeholder: "(none)",
                  onChange: (e) => setAgent(e.target.value)
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "cu-field", children: [
              /* @__PURE__ */ jsx("span", { className: "cu-field-label", children: "Permission mode" }),
              /* @__PURE__ */ jsxs(
                "select",
                {
                  value: permissionMode,
                  onChange: (e) => setPermissionMode(e.target.value),
                  children: [
                    /* @__PURE__ */ jsx("option", { value: "", children: "(default)" }),
                    PERMISSION_MODES.map((m) => /* @__PURE__ */ jsx("option", { value: m, children: m }, m))
                  ]
                }
              )
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "cu-field-row", children: [
            /* @__PURE__ */ jsxs("label", { className: "cu-field", children: [
              /* @__PURE__ */ jsx("span", { className: "cu-field-label", children: "Max turns" }),
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "number",
                  min: 1,
                  value: maxTurns,
                  placeholder: "(unset)",
                  onChange: (e) => setMaxTurns(e.target.value)
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "cu-field", children: [
              /* @__PURE__ */ jsx("span", { className: "cu-field-label", children: "Max budget (USD)" }),
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "number",
                  min: 0,
                  step: "0.5",
                  value: maxBudget,
                  placeholder: "(unset)",
                  onChange: (e) => setMaxBudget(e.target.value)
                }
              )
            ] })
          ] }),
          /* @__PURE__ */ jsxs("label", { className: "cu-field", children: [
            /* @__PURE__ */ jsx("span", { className: "cu-field-label", children: "Allowed tools" }),
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "text",
                value: allowedTools,
                placeholder: "e.g. Read,Edit,Grep (comma-separated)",
                onChange: (e) => setAllowedTools(e.target.value)
              }
            )
          ] }),
          error && /* @__PURE__ */ jsx("div", { className: "cu-modal-error", children: error })
        ] }),
        /* @__PURE__ */ jsxs("footer", { className: "cu-modal-footer", children: [
          /* @__PURE__ */ jsx("button", { type: "button", className: "cu-btn", onClick: onClose, disabled: launching, children: "Cancel" }),
          /* @__PURE__ */ jsxs("button", { type: "button", className: "cu-btn cu-btn--primary", onClick: submit, disabled: !canLaunch, children: [
            launching ? /* @__PURE__ */ jsx(LoaderCircle, { size: 13, className: "cu-spin" }) : /* @__PURE__ */ jsx(Rocket, { size: 13 }),
            /* @__PURE__ */ jsx("span", { children: "Launch" })
          ] })
        ] })
      ]
    }
  ) });
}
const STORAGE_GROUP_KEY = "groupBy";
const STORAGE_LIVE_KEY = "livePolling";
const POLL_INTERVAL_MS = 1e4;
let snapshot = null;
function CuFleetTab({ host, onFatal }) {
  const [daemon, setDaemon] = useState((snapshot == null ? void 0 : snapshot.daemon) ?? null);
  const [sessions, setSessions] = useState((snapshot == null ? void 0 : snapshot.sessions) ?? []);
  const [dashboard, setDashboard] = useState((snapshot == null ? void 0 : snapshot.dashboard) ?? null);
  const [groupBy, setGroupBy] = useState("repo");
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(!snapshot);
  const [error, setError] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(/* @__PURE__ */ new Set());
  const [confirmKill, setConfirmKill] = useState(null);
  const [postMortemFor, setPostMortemFor] = useState(null);
  const [launchOpen, setLaunchOpen] = useState(false);
  const fetching = useRef(false);
  useEffect(() => {
    let alive = true;
    Promise.all([
      host.storage.get(STORAGE_GROUP_KEY),
      host.storage.get(STORAGE_LIVE_KEY)
    ]).then(([g, l]) => {
      if (!alive) return;
      if (g === "status" || g === "repo") setGroupBy(g);
      if (l) setLive(true);
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, [host]);
  const publishBadge = useCallback(
    (list) => {
      const count = list.filter((s) => isRunning(s.status)).length;
      host.cache.set(RUNNING_COUNT_CACHE_KEY, count || null);
    },
    [host]
  );
  const isFatal = (msg) => {
    const m = msg.toLowerCase();
    return m.includes("not found") || m.includes("not installed") || m.includes("unexpectedly") || m.includes("unknown module") || m.includes("no such module");
  };
  const load = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    setLoading(true);
    try {
      const status = await host.call("daemonStatus");
      setDaemon(status);
      setError(null);
      if (!status.running) {
        publishBadge([]);
        onFatal("daemon down");
        return;
      }
      const [list, dash] = await Promise.all([
        host.call("listSessions"),
        host.call("dashboard").catch(() => null)
      ]);
      setSessions(list);
      setDashboard(dash);
      publishBadge(list);
      host.cache.set(FLEET_CACHE_KEY, list);
      snapshot = { daemon: status, sessions: list, dashboard: dash };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isFatal(msg)) {
        publishBadge([]);
        onFatal(msg);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
      fetching.current = false;
    }
  }, [host, publishBadge]);
  useEffect(() => {
    if (!hydrated) return;
    void load();
  }, [hydrated, load]);
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [live, load]);
  const toggleLive = () => {
    setLive((v) => {
      const next = !v;
      void host.storage.set(STORAGE_LIVE_KEY, next);
      return next;
    });
  };
  const selectGroupBy = (g) => {
    setGroupBy(g);
    void host.storage.set(STORAGE_GROUP_KEY, g);
  };
  const setRowBusy = (id, on) => setBusy((prev) => {
    const next = new Set(prev);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });
  const patchStatus = useCallback((id, status) => {
    setSessions((prev) => prev.map((s) => s.id === id ? { ...s, status } : s));
  }, []);
  const runAction = useCallback(
    async (session, capability, optimisticStatus) => {
      const { id, status: fromStatus } = session;
      setRowBusy(id, true);
      setConfirmKill(null);
      if (optimisticStatus) patchStatus(id, optimisticStatus);
      try {
        const res = await host.call(capability, id);
        if (!(res == null ? void 0 : res.ok)) {
          if (optimisticStatus && fromStatus) patchStatus(id, fromStatus);
          host.toast(
            `${sessionLabel(session)}: ${capability} failed${(res == null ? void 0 : res.message) ? ` — ${res.message}` : ""}`,
            "error"
          );
        } else {
          host.toast(`${sessionLabel(session)}: ${capability} ok.`);
          void load();
        }
      } catch (err) {
        if (optimisticStatus && fromStatus) patchStatus(id, fromStatus);
        host.toast(
          `${sessionLabel(session)}: ${capability} failed — ${err instanceof Error ? err.message : String(err)}`,
          "error"
        );
      } finally {
        setRowBusy(id, false);
      }
    },
    [host, patchStatus, load]
  );
  const groups = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    const rank = (s) => isRunning(s.status) ? 0 : isPaused(s.status) ? 1 : 2;
    const sorted = [...sessions].sort((a, b) => rank(a) - rank(b));
    for (const s of sorted) {
      const key = groupBy === "repo" ? repoBasename(s.repoPath) : s.status ?? "unknown";
      const arr = map.get(key);
      if (arr) arr.push(s);
      else map.set(key, [s]);
    }
    return Array.from(map.entries());
  }, [sessions, groupBy]);
  const runningCount = useMemo(() => sessions.filter((s) => isRunning(s.status)).length, [sessions]);
  const isEmpty = (daemon == null ? void 0 : daemon.running) && sessions.length === 0 && !loading && !error;
  const isLoadingFirst = loading && sessions.length === 0 && !error;
  return /* @__PURE__ */ jsxs("div", { className: "cu-fleet", children: [
    /* @__PURE__ */ jsxs("div", { className: "cu-subbar", children: [
      /* @__PURE__ */ jsx("div", { className: "cu-subbar-left", children: dashboard && /* @__PURE__ */ jsx(DashboardRollup, { dashboard, running: runningCount }) }),
      /* @__PURE__ */ jsxs("div", { className: "cu-subbar-right", children: [
        /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            className: `cu-live-toggle ${live ? "active" : ""}`,
            onClick: toggleLive,
            title: live ? "Live polling on (every 10s)" : "Live polling off",
            "aria-pressed": live,
            children: [
              /* @__PURE__ */ jsx(Radio, { size: 13, className: live ? "cu-pulse" : void 0 }),
              /* @__PURE__ */ jsx("span", { children: "Live" })
            ]
          }
        ),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            className: "icon-btn",
            onClick: () => void load(),
            disabled: loading,
            title: "Refresh",
            "aria-label": "Refresh",
            children: /* @__PURE__ */ jsx(RefreshCw, { size: 14, className: loading ? "cu-spin" : void 0 })
          }
        ),
        /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            className: "cu-btn cu-btn--primary cu-launch-cta",
            onClick: () => setLaunchOpen(true),
            title: "Launch a new session",
            children: [
              /* @__PURE__ */ jsx(Rocket, { size: 13 }),
              /* @__PURE__ */ jsx("span", { children: "Launch" })
            ]
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "cu-fleet-body", children: [
      error && /* @__PURE__ */ jsxs("div", { className: "cu-error", role: "alert", children: [
        /* @__PURE__ */ jsx(CircleAlert, { size: 16 }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("strong", { children: "Couldn't reach the fleet." }),
          /* @__PURE__ */ jsx("p", { children: error }),
          /* @__PURE__ */ jsxs("button", { type: "button", className: "cu-btn", onClick: () => void load(), children: [
            /* @__PURE__ */ jsx(RefreshCw, { size: 13 }),
            " ",
            /* @__PURE__ */ jsx("span", { children: "Retry" })
          ] })
        ] })
      ] }),
      isLoadingFirst && /* @__PURE__ */ jsxs("div", { className: "cu-loading", children: [
        /* @__PURE__ */ jsx(LoaderCircle, { size: 16, className: "cu-spin" }),
        " Connecting to the fleet…"
      ] }),
      isEmpty && /* @__PURE__ */ jsxs("div", { className: "cu-empty-state", children: [
        /* @__PURE__ */ jsx(Rocket, { size: 32, "aria-hidden": true }),
        /* @__PURE__ */ jsx("strong", { children: "No sessions yet" }),
        /* @__PURE__ */ jsx("p", { children: "The daemon is up but there are no sessions. Launch one to get started." }),
        /* @__PURE__ */ jsxs("button", { type: "button", className: "cu-btn cu-btn--primary", onClick: () => setLaunchOpen(true), children: [
          /* @__PURE__ */ jsx(Rocket, { size: 13 }),
          " ",
          /* @__PURE__ */ jsx("span", { children: "Launch session" })
        ] })
      ] }),
      !error && sessions.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsxs("div", { className: "cu-toolbar", children: [
          /* @__PURE__ */ jsxs("div", { className: "cu-group-switch", role: "tablist", "aria-label": "Group sessions by", children: [
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                role: "tab",
                "aria-selected": groupBy === "repo",
                className: `cu-group-tab ${groupBy === "repo" ? "active" : ""}`,
                onClick: () => selectGroupBy("repo"),
                children: "By repo"
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                role: "tab",
                "aria-selected": groupBy === "status",
                className: `cu-group-tab ${groupBy === "status" ? "active" : ""}`,
                onClick: () => selectGroupBy("status"),
                children: "By status"
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("span", { className: "cu-count-pill", children: [
            sessions.length,
            " ",
            sessions.length === 1 ? "session" : "sessions"
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "cu-groups", children: groups.map(([key, rows]) => /* @__PURE__ */ jsxs("div", { className: "cu-group", children: [
          /* @__PURE__ */ jsxs("div", { className: "cu-group-head", children: [
            /* @__PURE__ */ jsx("span", { className: "cu-group-title", children: key }),
            /* @__PURE__ */ jsx("span", { className: "cu-group-count", children: rows.length })
          ] }),
          /* @__PURE__ */ jsx("ul", { className: "cu-session-list", children: rows.map((s) => /* @__PURE__ */ jsx(
            CuSessionRow,
            {
              session: s,
              busy: busy.has(s.id),
              confirmingKill: confirmKill === s.id,
              onAction: runAction,
              onPostMortem: () => setPostMortemFor(s),
              onAskKill: () => setConfirmKill(s.id),
              onCancelKill: () => setConfirmKill(null)
            },
            s.id
          )) })
        ] }, key)) })
      ] })
    ] }),
    postMortemFor && /* @__PURE__ */ jsx(CuPostMortemModal, { host, session: postMortemFor, onClose: () => setPostMortemFor(null) }),
    launchOpen && /* @__PURE__ */ jsx(CuLaunchModal, { host, onClose: () => setLaunchOpen(false), onLaunched: () => void load() })
  ] });
}
function DashboardRollup({ dashboard, running }) {
  const cost = dashboard.totalCostUsd;
  return /* @__PURE__ */ jsxs("div", { className: "cu-rollup", title: "Fleet rollup", children: [
    /* @__PURE__ */ jsxs("span", { className: "cu-rollup-item", children: [
      /* @__PURE__ */ jsx(Zap, { size: 11, "aria-hidden": true }),
      " ",
      running,
      " running"
    ] }),
    typeof dashboard.totalSessions === "number" && /* @__PURE__ */ jsxs("span", { className: "cu-rollup-item", children: [
      dashboard.totalSessions,
      " total"
    ] }),
    typeof cost === "number" && /* @__PURE__ */ jsxs("span", { className: "cu-rollup-item", children: [
      "$",
      cost.toFixed(2)
    ] })
  ] });
}
function CuSessionRow({
  session,
  busy,
  confirmingKill,
  onAction,
  onPostMortem,
  onAskKill,
  onCancelKill
}) {
  const running = isRunning(session.status);
  const paused = isPaused(session.status);
  const terminal = isTerminal(session.status);
  const statusKey = (session.status ?? "unknown").toLowerCase().replace(/[^a-z]+/g, "-");
  return /* @__PURE__ */ jsxs("li", { className: "cu-session-row", children: [
    /* @__PURE__ */ jsxs("div", { className: "cu-session-main", children: [
      /* @__PURE__ */ jsx("span", { className: "cu-session-name", title: session.id, children: sessionLabel(session) }),
      /* @__PURE__ */ jsx("span", { className: `cu-status-pill cu-status-pill--${statusKey}`, children: session.status ?? "unknown" }),
      session.title && /* @__PURE__ */ jsx("span", { className: "cu-session-title", children: session.title })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "cu-session-meta", children: [
      typeof session.turns === "number" && /* @__PURE__ */ jsxs("span", { className: "cu-chip", title: "Turns", children: [
        session.turns,
        " turns"
      ] }),
      typeof session.costUsd === "number" && /* @__PURE__ */ jsxs("span", { className: "cu-chip", title: "Cost", children: [
        "$",
        session.costUsd.toFixed(2)
      ] }),
      session.profile && /* @__PURE__ */ jsx("span", { className: "cu-chip cu-chip--profile", children: session.profile }),
      session.model && /* @__PURE__ */ jsx("span", { className: "cu-chip cu-chip--model", children: session.model })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "cu-session-actions", children: [
      busy && /* @__PURE__ */ jsx(LoaderCircle, { size: 13, className: "cu-spin", "aria-label": "Working" }),
      !busy && confirmingKill && /* @__PURE__ */ jsxs("span", { className: "cu-confirm", children: [
        /* @__PURE__ */ jsx("span", { children: "Kill?" }),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            className: "cu-btn cu-btn--danger cu-btn--sm",
            onClick: () => onAction(session, "kill"),
            children: "Yes"
          }
        ),
        /* @__PURE__ */ jsx("button", { type: "button", className: "cu-btn cu-btn--sm", onClick: onCancelKill, children: "No" })
      ] }),
      !busy && !confirmingKill && /* @__PURE__ */ jsxs(Fragment, { children: [
        running && /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "icon-btn",
              title: "Pause",
              "aria-label": "Pause",
              onClick: () => onAction(session, "pause", "paused"),
              children: /* @__PURE__ */ jsx(Pause, { size: 13 })
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "icon-btn",
              title: "Unstick (nudge a stalled session)",
              "aria-label": "Unstick",
              onClick: () => onAction(session, "unstick"),
              children: /* @__PURE__ */ jsx(Zap, { size: 13 })
            }
          )
        ] }),
        paused && /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            className: "icon-btn",
            title: "Resume",
            "aria-label": "Resume",
            onClick: () => onAction(session, "resume", "running"),
            children: /* @__PURE__ */ jsx(Play, { size: 13 })
          }
        ),
        terminal ? /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            className: "icon-btn",
            title: "Post-mortem",
            "aria-label": "Post-mortem",
            onClick: onPostMortem,
            children: /* @__PURE__ */ jsx(FileText, { size: 13 })
          }
        ) : /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            className: "icon-btn cu-icon-danger",
            title: "Kill",
            "aria-label": "Kill",
            onClick: onAskKill,
            children: /* @__PURE__ */ jsx(Square, { size: 13 })
          }
        )
      ] })
    ] })
  ] });
}
function CatalogShell({ title, count, loading, error, emptyLabel, onReload, children }) {
  return /* @__PURE__ */ jsxs("div", { className: "cu-catalog", children: [
    /* @__PURE__ */ jsxs("div", { className: "cu-toolbar", children: [
      /* @__PURE__ */ jsxs("span", { className: "cu-count-pill", children: [
        count,
        " ",
        count === 1 ? title.replace(/s$/, "") : title
      ] }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: "icon-btn",
          onClick: onReload,
          disabled: loading,
          title: "Refresh",
          "aria-label": "Refresh",
          children: /* @__PURE__ */ jsx(RefreshCw, { size: 14, className: loading ? "cu-spin" : void 0 })
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "cu-catalog-body", children: [
      loading && count === 0 && /* @__PURE__ */ jsxs("div", { className: "cu-loading", children: [
        /* @__PURE__ */ jsx(LoaderCircle, { size: 16, className: "cu-spin" }),
        " Loading ",
        title,
        "…"
      ] }),
      error && /* @__PURE__ */ jsxs("div", { className: "cu-error", role: "alert", children: [
        /* @__PURE__ */ jsx(CircleAlert, { size: 16 }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsxs("strong", { children: [
            "Couldn't load ",
            title,
            "."
          ] }),
          /* @__PURE__ */ jsx("p", { children: error })
        ] })
      ] }),
      !loading && !error && count === 0 && /* @__PURE__ */ jsx("div", { className: "cu-empty-inline", children: emptyLabel }),
      !error && count > 0 && /* @__PURE__ */ jsx("ul", { className: "cu-catalog-list", children })
    ] })
  ] });
}
function CatalogRow({ icon, name, description, badge, onOpen, children, dim }) {
  return /* @__PURE__ */ jsxs(
    "li",
    {
      className: `cu-catalog-row cu-catalog-row--clickable ${dim ? "cu-row-dim" : ""}`,
      role: "button",
      tabIndex: 0,
      onClick: onOpen,
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      },
      title: `${name} — click for details`,
      children: [
        /* @__PURE__ */ jsxs("div", { className: "cu-catalog-main", children: [
          icon,
          /* @__PURE__ */ jsx("span", { className: "cu-catalog-name", children: name }),
          badge,
          description && /* @__PURE__ */ jsx("span", { className: "cu-catalog-desc", children: description })
        ] }),
        /* @__PURE__ */ jsx(
          "div",
          {
            className: "cu-catalog-meta",
            onClick: (e) => e.stopPropagation(),
            onKeyDown: (e) => e.stopPropagation(),
            children
          }
        )
      ]
    }
  );
}
const KIND_LABEL = {
  profile: "Profile",
  agent: "Agent",
  "agent-group": "Agent group",
  workflow: "Workflow",
  schedule: "Schedule",
  subscription: "GUS trigger"
};
function scalarFacts(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const out = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (v == null) continue;
    if (typeof v === "string") {
      if (v.includes("\n") || v.length > 80) continue;
      out.push([k, v]);
    } else if (typeof v === "number" || typeof v === "boolean") {
      out.push([k, String(v)]);
    } else if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      out.push([k, v.join(", ")]);
    }
  }
  return out;
}
function CuDetailModal({ host, kind, name, repoPath, onClose }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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
    host.call("showDetail", kind, name, repoPath).then((res) => {
      if (!live) return;
      setText((res == null ? void 0 : res.text) ?? "");
      setParsed((res == null ? void 0 : res.parsed) ?? null);
    }).catch((err) => {
      if (live) setError(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [host, kind, name, repoPath]);
  const facts = scalarFacts(parsed);
  return /* @__PURE__ */ jsx("div", { className: "palette-backdrop", onMouseDown: onClose, children: /* @__PURE__ */ jsxs(
    "div",
    {
      className: "cu-modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": `${KIND_LABEL[kind]} ${name}`,
      onMouseDown: (e) => e.stopPropagation(),
      children: [
        /* @__PURE__ */ jsxs("header", { className: "cu-modal-header", children: [
          /* @__PURE__ */ jsxs("div", { className: "cu-modal-title", children: [
            /* @__PURE__ */ jsx("span", { className: "cu-detail-kind", children: KIND_LABEL[kind] }),
            /* @__PURE__ */ jsx("span", { children: name })
          ] }),
          /* @__PURE__ */ jsx("button", { type: "button", className: "icon-btn", "aria-label": "Close", onClick: onClose, children: /* @__PURE__ */ jsx(X, { size: 14 }) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "cu-modal-body", children: [
          loading && /* @__PURE__ */ jsxs("div", { className: "cu-modal-loading", children: [
            /* @__PURE__ */ jsx(LoaderCircle, { size: 14, className: "cu-spin" }),
            " Loading…"
          ] }),
          error && /* @__PURE__ */ jsx("div", { className: "cu-modal-error", children: error }),
          !loading && !error && facts.length > 0 && /* @__PURE__ */ jsx("dl", { className: "cu-facts", children: facts.map(([k, v]) => /* @__PURE__ */ jsxs("div", { className: "cu-fact", children: [
            /* @__PURE__ */ jsx("dt", { children: k }),
            /* @__PURE__ */ jsx("dd", { children: v })
          ] }, k)) }),
          !loading && !error && /* @__PURE__ */ jsxs("div", { className: "cu-modal-section", children: [
            /* @__PURE__ */ jsx("div", { className: "cu-modal-section-label", children: "Definition" }),
            text ? /* @__PURE__ */ jsx("pre", { className: "cu-code cu-detail-body", children: text }) : /* @__PURE__ */ jsx("div", { className: "cu-modal-empty", children: "No definition returned." })
          ] })
        ] })
      ]
    }
  ) });
}
function useCatalog(host, capability, ...args) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const argKey = JSON.stringify(args);
  const reload = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    host.call(capability, ...args).then((rows) => {
      if (alive) setData(Array.isArray(rows) ? rows : []);
    }).catch((err) => {
      if (alive) setError(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [host, capability, argKey]);
  useEffect(() => {
    const cancel = reload();
    return cancel;
  }, [reload]);
  return { data, loading, error, reload };
}
function CuProfilesTab({ host }) {
  const { data, loading, error, reload } = useCatalog(host, "listProfiles");
  const [open, setOpen] = useState(null);
  return /* @__PURE__ */ jsxs(
    CatalogShell,
    {
      title: "profiles",
      count: data.length,
      loading,
      error,
      emptyLabel: "No saved profiles. Create one with `cu profiles save`.",
      onReload: reload,
      children: [
        data.map((p) => /* @__PURE__ */ jsxs(
          CatalogRow,
          {
            icon: /* @__PURE__ */ jsx(Settings2, { size: 13, className: "cu-catalog-icon", "aria-hidden": true }),
            name: p.name,
            description: p.description,
            onOpen: () => setOpen(p.name),
            children: [
              p.model && /* @__PURE__ */ jsx("span", { className: "cu-chip cu-chip--model", children: p.model }),
              p.permissionMode && /* @__PURE__ */ jsx("span", { className: "cu-chip", children: p.permissionMode }),
              typeof p.maxTurns === "number" && /* @__PURE__ */ jsxs("span", { className: "cu-chip", children: [
                p.maxTurns,
                " turns"
              ] }),
              typeof p.maxBudgetUsd === "number" && /* @__PURE__ */ jsxs("span", { className: "cu-chip", children: [
                "$",
                p.maxBudgetUsd.toFixed(2)
              ] })
            ]
          },
          p.name
        )),
        open && /* @__PURE__ */ jsx(CuDetailModal, { host, kind: "profile", name: open, onClose: () => setOpen(null) })
      ]
    }
  );
}
function CuAgentsTab({ host }) {
  const repoPath = useMemo(() => {
    var _a;
    return (_a = host.getActiveProject()) == null ? void 0 : _a.path;
  }, [host]);
  const agents = useCatalog(host, "listAgents", repoPath);
  const groups = useCatalog(host, "listAgentGroups");
  const [detail, setDetail] = useState(null);
  return /* @__PURE__ */ jsxs("div", { className: "cu-agents-tab", children: [
    /* @__PURE__ */ jsx(
      CatalogShell,
      {
        title: "agents",
        count: agents.data.length,
        loading: agents.loading,
        error: agents.error,
        emptyLabel: "No agents. Create one with `cu agents save`.",
        onReload: agents.reload,
        children: agents.data.map((a) => /* @__PURE__ */ jsxs(
          CatalogRow,
          {
            icon: /* @__PURE__ */ jsx(Bot, { size: 13, className: "cu-catalog-icon", "aria-hidden": true }),
            name: a.name,
            description: a.description,
            badge: a.scope === "repo" ? /* @__PURE__ */ jsx("span", { className: "cu-chip cu-chip--scope", children: "repo" }) : void 0,
            onOpen: () => setDetail({ kind: "agent", name: a.name }),
            children: [
              a.archetype && /* @__PURE__ */ jsx("span", { className: "cu-chip", children: a.archetype }),
              a.model && /* @__PURE__ */ jsx("span", { className: "cu-chip cu-chip--model", children: a.model }),
              a.allowedTools && a.allowedTools.length > 0 && /* @__PURE__ */ jsxs("span", { className: "cu-chip cu-chip--tools", title: a.allowedTools.join(", "), children: [
                a.allowedTools.length,
                " tools"
              ] })
            ]
          },
          `${a.scope ?? "user"}:${a.name}`
        ))
      }
    ),
    groups.data.length > 0 && /* @__PURE__ */ jsx(
      CatalogShell,
      {
        title: "agent groups",
        count: groups.data.length,
        loading: groups.loading,
        error: groups.error,
        emptyLabel: "No agent groups.",
        onReload: groups.reload,
        children: groups.data.map((g) => /* @__PURE__ */ jsxs(
          CatalogRow,
          {
            icon: /* @__PURE__ */ jsx(Boxes, { size: 13, className: "cu-catalog-icon", "aria-hidden": true }),
            name: g.name,
            description: g.description,
            onOpen: () => setDetail({ kind: "agent-group", name: g.name }),
            children: [
              g.coordinator && /* @__PURE__ */ jsxs("span", { className: "cu-chip", children: [
                "coord: ",
                g.coordinator
              ] }),
              g.members && g.members.length > 0 && /* @__PURE__ */ jsxs("span", { className: "cu-chip", title: g.members.join(", "), children: [
                g.members.length,
                " members"
              ] })
            ]
          },
          g.name
        ))
      }
    ),
    detail && /* @__PURE__ */ jsx(
      CuDetailModal,
      {
        host,
        kind: detail.kind,
        name: detail.name,
        repoPath: detail.kind === "agent" ? repoPath : void 0,
        onClose: () => setDetail(null)
      }
    )
  ] });
}
function CuWorkflowsTab({ host }) {
  const project = useMemo(() => host.getActiveProject(), [host]);
  const workflows = useCatalog(host, "listWorkflows");
  const runs = useCatalog(host, "listWorkflowRuns");
  const [running, setRunning] = useState(null);
  const [open, setOpen] = useState(null);
  const runWorkflow = async (name) => {
    if (!project) {
      host.toast("Open a project to run a workflow.", "error");
      return;
    }
    setRunning(name);
    try {
      const res = await host.call("runWorkflow", name, project.path);
      host.toast(`Started workflow ${name}${(res == null ? void 0 : res.sessionId) ? ` (${res.sessionId})` : ""}.`);
      runs.reload();
    } catch (err) {
      host.toast(
        `Couldn't run ${name} — ${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    } finally {
      setRunning(null);
    }
  };
  return /* @__PURE__ */ jsxs("div", { className: "cu-workflows-tab", children: [
    /* @__PURE__ */ jsx(
      CatalogShell,
      {
        title: "workflows",
        count: workflows.data.length,
        loading: workflows.loading,
        error: workflows.error,
        emptyLabel: "No saved workflows. Create one with `cu workflow save`.",
        onReload: workflows.reload,
        children: workflows.data.map((w) => /* @__PURE__ */ jsxs(
          CatalogRow,
          {
            icon: /* @__PURE__ */ jsx(Workflow, { size: 13, className: "cu-catalog-icon", "aria-hidden": true }),
            name: w.name,
            description: w.description,
            badge: w.scope === "repo" ? /* @__PURE__ */ jsx("span", { className: "cu-chip cu-chip--scope", children: "repo" }) : void 0,
            onOpen: () => setOpen(w.name),
            children: [
              typeof w.nodeCount === "number" && /* @__PURE__ */ jsxs("span", { className: "cu-chip", children: [
                w.nodeCount,
                " nodes"
              ] }),
              /* @__PURE__ */ jsxs(
                "button",
                {
                  type: "button",
                  className: "cu-btn cu-btn--sm",
                  onClick: () => void runWorkflow(w.name),
                  disabled: running === w.name || !project,
                  title: project ? `Run in ${project.name}` : "Open a project to run",
                  children: [
                    running === w.name ? /* @__PURE__ */ jsx(LoaderCircle, { size: 12, className: "cu-spin" }) : /* @__PURE__ */ jsx(Play, { size: 12 }),
                    /* @__PURE__ */ jsx("span", { children: "Run" })
                  ]
                }
              )
            ]
          },
          w.name
        ))
      }
    ),
    runs.data.length > 0 && /* @__PURE__ */ jsx(
      CatalogShell,
      {
        title: "recent runs",
        count: runs.data.length,
        loading: runs.loading,
        error: runs.error,
        emptyLabel: "No runs yet.",
        onReload: runs.reload,
        children: runs.data.map((r) => /* @__PURE__ */ jsxs("li", { className: "cu-catalog-row", children: [
          /* @__PURE__ */ jsxs("div", { className: "cu-catalog-main", children: [
            /* @__PURE__ */ jsx(History, { size: 13, className: "cu-catalog-icon", "aria-hidden": true }),
            /* @__PURE__ */ jsx("span", { className: "cu-catalog-name", children: r.workflow ?? r.token })
          ] }),
          /* @__PURE__ */ jsx("div", { className: "cu-catalog-meta", children: r.status && /* @__PURE__ */ jsx(
            "span",
            {
              className: `cu-status-pill cu-status-pill--${(r.status ?? "").toLowerCase().replace(/[^a-z]+/g, "-")}`,
              children: r.status
            }
          ) })
        ] }, r.token))
      }
    ),
    open && /* @__PURE__ */ jsx(CuDetailModal, { host, kind: "workflow", name: open, onClose: () => setOpen(null) })
  ] });
}
function CuSchedulesTab({ host }) {
  const schedules = useCatalog(host, "listSchedules");
  const subs = useCatalog(host, "listSubscriptions");
  const [busy, setBusy] = useState(null);
  const [detail, setDetail] = useState(null);
  const act = async (name, capability, verb) => {
    setBusy(name);
    try {
      const res = await host.call(capability, name);
      host.toast(
        (res == null ? void 0 : res.ok) ? `${name}: ${verb} ok.` : `${name}: ${verb} failed${(res == null ? void 0 : res.message) ? ` — ${res.message}` : ""}`,
        (res == null ? void 0 : res.ok) ? "info" : "error"
      );
      if (res == null ? void 0 : res.ok) schedules.reload();
    } catch (err) {
      host.toast(`${name}: ${verb} failed — ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setBusy(null);
    }
  };
  return /* @__PURE__ */ jsxs("div", { className: "cu-schedules-tab", children: [
    /* @__PURE__ */ jsx(
      CatalogShell,
      {
        title: "schedules",
        count: schedules.data.length,
        loading: schedules.loading,
        error: schedules.error,
        emptyLabel: "No schedules. Create one with `cu schedules add`.",
        onReload: schedules.reload,
        children: schedules.data.map((s) => /* @__PURE__ */ jsxs(
          CatalogRow,
          {
            icon: /* @__PURE__ */ jsx(Clock, { size: 13, className: "cu-catalog-icon", "aria-hidden": true }),
            name: s.name,
            dim: s.enabled === false,
            badge: /* @__PURE__ */ jsxs(Fragment, { children: [
              s.lastFailed && /* @__PURE__ */ jsx("span", { className: "cu-chip cu-chip--fail", children: "last run failed" }),
              s.cron && /* @__PURE__ */ jsx("code", { className: "cu-cron", children: s.cron })
            ] }),
            onOpen: () => setDetail({ kind: "schedule", name: s.name }),
            children: [
              s.kind && /* @__PURE__ */ jsx("span", { className: "cu-chip", children: s.kind }),
              (s.agent || s.agentGroup) && /* @__PURE__ */ jsx("span", { className: "cu-chip cu-chip--profile", children: s.agent ?? s.agentGroup }),
              busy === s.name ? /* @__PURE__ */ jsx(LoaderCircle, { size: 13, className: "cu-spin" }) : /* @__PURE__ */ jsxs(Fragment, { children: [
                /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    className: "icon-btn",
                    title: "Run now",
                    "aria-label": "Run now",
                    onClick: () => void act(s.name, "scheduleRunNow", "run-now"),
                    children: /* @__PURE__ */ jsx(Play, { size: 13 })
                  }
                ),
                s.enabled === false ? /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    className: "icon-btn",
                    title: "Enable",
                    "aria-label": "Enable",
                    onClick: () => void act(s.name, "scheduleEnable", "enable"),
                    children: /* @__PURE__ */ jsx(Power, { size: 13 })
                  }
                ) : /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    className: "icon-btn",
                    title: "Disable",
                    "aria-label": "Disable",
                    onClick: () => void act(s.name, "scheduleDisable", "disable"),
                    children: /* @__PURE__ */ jsx(PowerOff, { size: 13 })
                  }
                )
              ] })
            ]
          },
          s.name
        ))
      }
    ),
    subs.data.length > 0 && /* @__PURE__ */ jsx(
      CatalogShell,
      {
        title: "GUS triggers",
        count: subs.data.length,
        loading: subs.loading,
        error: subs.error,
        emptyLabel: "No GUS-CDC subscriptions.",
        onReload: subs.reload,
        children: subs.data.map((s) => /* @__PURE__ */ jsxs(
          CatalogRow,
          {
            icon: /* @__PURE__ */ jsx(Webhook, { size: 13, className: "cu-catalog-icon", "aria-hidden": true }),
            name: s.name,
            dim: s.enabled === false,
            description: s.fields && s.fields.length > 0 ? `on ${s.fields.join(", ")}` : void 0,
            onOpen: () => setDetail({ kind: "subscription", name: s.name }),
            children: [
              s.targetType && /* @__PURE__ */ jsx("span", { className: "cu-chip", children: s.targetType }),
              s.changeTypes && s.changeTypes.map((c) => /* @__PURE__ */ jsx("span", { className: "cu-chip", children: c }, c))
            ]
          },
          s.name
        ))
      }
    ),
    detail && /* @__PURE__ */ jsx(
      CuDetailModal,
      {
        host,
        kind: detail.kind,
        name: detail.name,
        onClose: () => setDetail(null)
      }
    )
  ] });
}
const STORAGE_TAB_KEY = "activeTab";
const DOCS_URL = "https://git.soma.salesforce.com/cc-oms/claude-unleashed";
function gateForError(message) {
  const m = message.toLowerCase();
  if (m.includes("unknown module") || m.includes("no such module")) return "needs-relaunch";
  if (m.includes("not found") || m.includes("not installed") || m.includes("unexpectedly"))
    return "not-installed";
  return null;
}
const TAB_LABELS = {
  fleet: "Fleet",
  profiles: "Profiles",
  agents: "Agents",
  workflows: "Workflows",
  schedules: "Schedules"
};
function CuPanel({ host }) {
  const [gate, setGate] = useState("loading");
  const [daemon, setDaemon] = useState(null);
  const [starting, setStarting] = useState(false);
  const [activeTab, setActiveTab] = useState("fleet");
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let alive = true;
    host.storage.get(STORAGE_TAB_KEY).then((t) => {
      if (!alive) return;
      if (t && CU_TABS.includes(t)) setActiveTab(t);
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, [host]);
  const checkGate = useCallback(async () => {
    setGate((g) => g === "ok" ? g : "loading");
    try {
      const status = await host.call("daemonStatus");
      setDaemon(status);
      setGate(status.running ? "ok" : "daemon-down");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGate(gateForError(msg) ?? "daemon-down");
    }
  }, [host]);
  useEffect(() => {
    void checkGate();
  }, [checkGate]);
  const selectTab = (t) => {
    setActiveTab(t);
    void host.storage.set(STORAGE_TAB_KEY, t);
  };
  const onFatal = useCallback(() => {
    void checkGate();
  }, [checkGate]);
  const startDaemon = useCallback(async () => {
    setStarting(true);
    try {
      const res = await host.call("startDaemon");
      if (res == null ? void 0 : res.ok) {
        host.toast("Daemon started.");
        await checkGate();
      } else {
        host.toast(`Couldn't start daemon${(res == null ? void 0 : res.message) ? ` — ${res.message}` : ""}`, "error");
      }
    } catch (err) {
      host.toast(
        `Couldn't start daemon — ${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    } finally {
      setStarting(false);
    }
  }, [host, checkGate]);
  return /* @__PURE__ */ jsxs("section", { className: "cu-panel", children: [
    /* @__PURE__ */ jsx("header", { className: "cu-header", children: /* @__PURE__ */ jsxs("div", { className: "cu-header-title", children: [
      /* @__PURE__ */ jsx(Bot, { size: 16, className: "cu-header-icon", "aria-hidden": true }),
      /* @__PURE__ */ jsx("h2", { children: "Claude Unleashed" }),
      /* @__PURE__ */ jsx(DaemonPill, { gate, daemon })
    ] }) }),
    gate === "ok" && /* @__PURE__ */ jsx("nav", { className: "cu-tabs", role: "tablist", "aria-label": "Claude Unleashed sections", children: CU_TABS.map((t) => /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        role: "tab",
        "aria-selected": activeTab === t,
        className: `cu-tab ${activeTab === t ? "active" : ""}`,
        onClick: () => selectTab(t),
        children: TAB_LABELS[t]
      },
      t
    )) }),
    /* @__PURE__ */ jsxs("div", { className: "cu-content", children: [
      gate === "loading" && /* @__PURE__ */ jsxs("div", { className: "cu-loading", children: [
        /* @__PURE__ */ jsx(LoaderCircle, { size: 16, className: "cu-spin" }),
        " Connecting to the daemon…"
      ] }),
      gate === "needs-relaunch" && /* @__PURE__ */ jsxs("div", { className: "cu-empty-state", children: [
        /* @__PURE__ */ jsx(RotateCw, { size: 32, "aria-hidden": true }),
        /* @__PURE__ */ jsx("strong", { children: "Relaunch to activate" }),
        /* @__PURE__ */ jsx("p", { children: "Claude Unleashed was just installed. Its background process starts when the app launches — quit and reopen Claude Code Terminal Center to finish activating it." })
      ] }),
      gate === "not-installed" && /* @__PURE__ */ jsxs("div", { className: "cu-empty-state", children: [
        /* @__PURE__ */ jsx(Bot, { size: 32, "aria-hidden": true }),
        /* @__PURE__ */ jsx("strong", { children: "Claude Unleashed isn't installed" }),
        /* @__PURE__ */ jsxs("p", { children: [
          "The ",
          /* @__PURE__ */ jsx("code", { children: "claude-unleashed" }),
          " CLI isn't on your PATH. Install it, then refresh."
        ] }),
        /* @__PURE__ */ jsxs("button", { type: "button", className: "cu-btn", onClick: () => host.openExternal(DOCS_URL), children: [
          /* @__PURE__ */ jsx(ExternalLink, { size: 13 }),
          " ",
          /* @__PURE__ */ jsx("span", { children: "Open docs" })
        ] })
      ] }),
      gate === "daemon-down" && /* @__PURE__ */ jsxs("div", { className: "cu-empty-state", children: [
        /* @__PURE__ */ jsx(Power, { size: 32, "aria-hidden": true }),
        /* @__PURE__ */ jsx("strong", { children: "Daemon stopped" }),
        /* @__PURE__ */ jsx("p", { children: "The local claude-unleashed daemon isn't running. Start it to use Claude Unleashed." }),
        /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            className: "cu-btn cu-btn--primary",
            onClick: () => void startDaemon(),
            disabled: starting,
            children: [
              starting ? /* @__PURE__ */ jsx(LoaderCircle, { size: 13, className: "cu-spin" }) : /* @__PURE__ */ jsx(Power, { size: 13 }),
              /* @__PURE__ */ jsx("span", { children: "Start daemon" })
            ]
          }
        )
      ] }),
      gate === "ok" && hydrated && /* @__PURE__ */ jsxs(Fragment, { children: [
        activeTab === "fleet" && /* @__PURE__ */ jsx(CuFleetTab, { host, onFatal }),
        activeTab === "profiles" && /* @__PURE__ */ jsx(CuProfilesTab, { host }),
        activeTab === "agents" && /* @__PURE__ */ jsx(CuAgentsTab, { host }),
        activeTab === "workflows" && /* @__PURE__ */ jsx(CuWorkflowsTab, { host }),
        activeTab === "schedules" && /* @__PURE__ */ jsx(CuSchedulesTab, { host })
      ] })
    ] })
  ] });
}
function DaemonPill({ gate, daemon }) {
  if (gate === "not-installed") {
    return /* @__PURE__ */ jsx("span", { className: "cu-daemon-pill cu-daemon-pill--off", children: "CLI missing" });
  }
  if (gate === "needs-relaunch") {
    return /* @__PURE__ */ jsx("span", { className: "cu-daemon-pill cu-daemon-pill--off", children: "Relaunch" });
  }
  if (gate === "loading") {
    return /* @__PURE__ */ jsx("span", { className: "cu-daemon-pill", children: "…" });
  }
  const up = gate === "ok" && ((daemon == null ? void 0 : daemon.running) ?? true);
  return /* @__PURE__ */ jsxs("span", { className: `cu-daemon-pill ${up ? "cu-daemon-pill--on" : "cu-daemon-pill--off"}`, children: [
    /* @__PURE__ */ jsx("span", { className: "cu-daemon-dot", "aria-hidden": true }),
    up ? "Daemon up" : "Daemon down"
  ] });
}
const entry = {
  activate({ React, host }) {
    setHostReact(React);
    return {
      panel: CuPanel,
      // Core namespaces these as `ext:cu:<id>`.
      commands: (h) => [
        {
          id: "refresh-fleet",
          label: "Fleet: refresh sessions",
          keywords: ["claude unleashed", "cu", "reload", "sessions"],
          run: () => h.toast("Open Fleet to see the refreshed sessions.")
        },
        {
          id: "pause-all",
          label: "Fleet: pause all sessions",
          keywords: ["claude unleashed", "cu", "stop", "suspend"],
          run: () => {
            void h.call("pauseAll").then(
              (r) => h.toast((r == null ? void 0 : r.ok) ? "Paused all running sessions." : "Couldn't pause sessions.", (r == null ? void 0 : r.ok) ? "info" : "error")
            ).catch(
              (err) => h.toast(
                `Couldn't pause sessions — ${err instanceof Error ? err.message : String(err)}`,
                "error"
              )
            );
          }
        }
      ],
      // Sidebar nav badge: number of running sessions. Cheap + synchronous — it
      // reads the count the panel/poller stashes in the host cache after each
      // fetch (see CuPanel). null/0 → no badge.
      navBadge: (h) => h.cache.get(RUNNING_COUNT_CACHE_KEY) ?? null
    };
  }
};
export {
  entry as default
};
