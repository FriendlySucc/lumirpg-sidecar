// src/geometry.ts
var VALID_KINDS = new Set([
  "room",
  "hallway",
  "street",
  "shop",
  "landmark",
  "settlement",
  "district",
  "region",
  "kingdom",
  "mountain",
  "water",
  "forest",
  "desert",
  "marsh",
  "ruin",
  "exit",
  "other"
]);
var VALID_STATUSES = new Set([
  "current",
  "visited",
  "known",
  "rumored",
  "locked",
  "unexplored"
]);
var VALID_ROAD_KINDS = new Set([
  "road",
  "path",
  "door",
  "stairs",
  "transit",
  "sea_route"
]);
var REGION_PALETTE = [
  "#8b5a7c",
  "#4e7a8c",
  "#8c6f4e",
  "#5c7c5a",
  "#8c5a5a",
  "#5e648c",
  "#7c764e",
  "#4e7c71",
  "#7c5e8a",
  "#8a624a"
];
var PIN_PALETTE = [
  "#f59e0b",
  "#38bdf8",
  "#f472b6",
  "#4ade80",
  "#c084fc",
  "#fb7185",
  "#2dd4bf",
  "#facc15"
];
function hashString(input) {
  let h = 2166136261;
  for (let i = 0;i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function isValidHexColor(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}
function defaultTileColor(tile, scale) {
  if (tile.status === "locked" || tile.status === "unexplored")
    return "#2e3142";
  if (isValidHexColor(tile.color))
    return tile.color.trim();
  switch (tile.kind) {
    case "water":
      return "#2c5473";
    case "mountain":
      return "#5c5a66";
    case "forest":
      return "#365947";
    case "desert":
      return "#8a734b";
    case "marsh":
      return "#475c52";
    case "ruin":
      return "#664a52";
    case "hallway":
    case "street":
      return "#3d4257";
    case "exit":
      return "#4c576e";
    case "shop":
      return "#5d4d6e";
    default:
      break;
  }
  if (scale === "world" || scale === "region") {
    const idx = hashString(tile.id || tile.name) % REGION_PALETTE.length;
    return REGION_PALETTE[idx];
  }
  return "#363c52";
}
function defaultPinColor(pin) {
  if (pin.isPlayer)
    return "#fef08a";
  if (isValidHexColor(pin.color))
    return pin.color.trim();
  return PIN_PALETTE[hashString(pin.name.toLowerCase()) % PIN_PALETTE.length];
}
function computeViewBox(tiles, padding = 8) {
  if (!tiles.length)
    return { x: -50, y: -50, w: 100, h: 100 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tiles) {
    if (t.x < minX)
      minX = t.x;
    if (t.y < minY)
      minY = t.y;
    if (t.x + t.w > maxX)
      maxX = t.x + t.w;
    if (t.y + t.h > maxY)
      maxY = t.y + t.h;
  }
  const w = Math.max(40, maxX - minX + padding * 2);
  const h = Math.max(40, maxY - minY + padding * 2);
  return {
    x: minX - padding,
    y: minY - padding,
    w,
    h
  };
}
function findSharedEdge(a, b, eps = 0.5) {
  if (Math.abs(a.x + a.w - b.x) <= eps || Math.abs(b.x + b.w - a.x) <= eps) {
    const edgeX = Math.abs(a.x + a.w - b.x) <= eps ? a.x + a.w : a.x;
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    if (bottom - top >= 2) {
      return {
        x1: edgeX,
        y1: top,
        x2: edgeX,
        y2: bottom,
        midX: edgeX,
        midY: (top + bottom) / 2,
        orientation: "vertical"
      };
    }
  }
  if (Math.abs(a.y + a.h - b.y) <= eps || Math.abs(b.y + b.h - a.y) <= eps) {
    const edgeY = Math.abs(a.y + a.h - b.y) <= eps ? a.y + a.h : a.y;
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + a.w, b.x + b.w);
    if (right - left >= 2) {
      return {
        x1: left,
        y1: edgeY,
        x2: right,
        y2: edgeY,
        midX: (left + right) / 2,
        midY: edgeY,
        orientation: "horizontal"
      };
    }
  }
  return null;
}
function connectorSegment(a, b) {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  return [ax, ay, bx, by];
}

// src/frontend.ts
var SVG_NS = "http://www.w3.org/2000/svg";
var ATLAS_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8Zm4.2-12.2-6.1 2.4-2.3 6 6.1-2.4 2.3-6Zm-4.2 5.4a1.2 1.2 0 1 1 1.2-1.2 1.2 1.2 0 0 1-1.2 1.2Z"/></svg>';
var STYLES = `
.la-root {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  height: 100%;
  min-height: 0;
  color: var(--lumiverse-text, #eef0f7);
  font-family: var(--lumiverse-font, system-ui, -apple-system, sans-serif);
  font-size: 13px;
  line-height: 1.4;
}
.la-root * { box-sizing: border-box; }
.la-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.la-title-group {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.la-location {
  font-size: 15px;
  font-weight: 700;
  color: var(--lumiverse-text, #f5f6fb);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.la-subtitle {
  font-size: 11px;
  color: var(--lumiverse-text-muted, #9ea5bc);
}
.la-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.la-btn {
  appearance: none;
  border: 1px solid var(--lumiverse-border, #3e4359);
  background: var(--lumiverse-fill-subtle, #232638);
  color: var(--lumiverse-text, #eef0f7);
  border-radius: 8px;
  padding: 5px 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, opacity 120ms ease;
}
.la-btn:hover:not(:disabled) {
  border-color: var(--lumiverse-primary, #9b8cff);
  background: #2c3047;
}
.la-btn:disabled { opacity: 0.48; cursor: not-allowed; }
.la-btn[hidden] { display: none; }
.la-btn-primary {
  background: var(--lumiverse-primary, #7c6cf6);
  border-color: var(--lumiverse-primary, #7c6cf6);
  color: #ffffff;
}
.la-btn-primary:hover:not(:disabled) {
  background: #8e7fff;
  border-color: #8e7fff;
}
.la-btn-danger {
  border-color: #c75b6b;
  color: #ffb8c2;
}
.la-btn-icon {
  padding: 5px 8px;
  min-width: 28px;
  text-align: center;
}
.la-btn-active {
  border-color: var(--lumiverse-primary, #9b8cff);
  background: rgba(124, 108, 246, 0.22);
}

.la-settings {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--lumiverse-border, #3e4359);
  border-radius: 10px;
  background: var(--lumiverse-fill-subtle, #1e2130);
}
.la-settings[hidden] { display: none; }
.la-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--lumiverse-text-muted, #aeb4c8);
}
.la-select {
  width: 100%;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, #3e4359);
  background: #171926;
  color: var(--lumiverse-text, #eef0f7);
  font: inherit;
  font-size: 12px;
}
.la-toggles {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.la-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  color: var(--lumiverse-text, #eef0f7);
}
.la-check input {
  accent-color: var(--lumiverse-primary, #7c6cf6);
  width: 15px;
  height: 15px;
  margin: 0;
}

.la-banner {
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  border: 1px solid var(--lumiverse-border, #3e4359);
  background: #232638;
}
.la-banner[hidden] { display: none; }
.la-banner-error {
  border-color: #c75b6b;
  background: rgba(199, 91, 107, 0.14);
  color: #ffc8d0;
}
.la-banner-stale {
  border-color: #d9a441;
  background: rgba(217, 164, 65, 0.14);
  color: #ffe3a8;
}

.la-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.la-browser-nav {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
  gap: 8px;
  min-width: 0;
}
.la-browser-nav .la-field { min-width: 0; }
.la-browser-nav .la-field:last-child { grid-column: 1 / -1; }
.la-browser-nav select:disabled { opacity: 0.55; }
.la-browser-nav select { min-height: 40px; }
@media (min-width: 500px) {
  .la-browser-nav .la-field:last-child { grid-column: auto; }
}
.la-toolbar[hidden], .la-canvas-wrap[hidden], .la-inspector[hidden] { display: none; }
.la-state-panel {
  border: 1px solid var(--lumiverse-border, #3e4359);
  border-radius: 10px;
  background: var(--lumiverse-fill-subtle, #1e2130);
  padding: 10px 12px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.la-state-panel[hidden] { display: none; }
.la-state-section + .la-state-section {
  border-top: 1px solid rgba(255,255,255,0.08);
  margin-top: 10px;
  padding-top: 10px;
}
.la-state-text {
  margin: 5px 0 0;
  font: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--lumiverse-text, #dce0f0);
}
.la-layer-tools {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.la-floors {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}

.la-canvas-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  min-height: 260px;
  max-height: 520px;
  border: 1px solid var(--lumiverse-border, #434861);
  border-radius: 12px;
  overflow: hidden;
  background: radial-gradient(circle at 50% 45%, #1d2233 0%, #131622 100%);
  touch-action: none;
  user-select: none;
}
.la-canvas-wrap.la-dragging { cursor: grabbing; }
.la-canvas-wrap:not(.la-dragging) { cursor: grab; }
.la-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.la-empty-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  text-align: center;
  color: var(--lumiverse-text-muted, #aeb4c8);
  background: rgba(19, 22, 34, 0.72);
  pointer-events: none;
}
.la-empty-overlay[hidden] { display: none; }
.la-empty-overlay strong {
  color: var(--lumiverse-text, #eef0f7);
  font-size: 14px;
}
.la-thinking {
  border: 1px solid var(--lumiverse-border, #3e4359);
  border-radius: 10px;
  background: #191c2b;
  overflow: hidden;
}
.la-thinking[hidden] { display: none; }
.la-thinking-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  background: rgba(124, 108, 246, 0.12);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  user-select: none;
}
.la-thinking-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
  color: #dcd6ff;
}
.la-thinking-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--lumiverse-primary, #9b8cff);
  flex: none;
}
.la-thinking-dot.la-pulse {
  animation: la-pulse-anim 1.2s ease-in-out infinite;
}
@keyframes la-pulse-anim {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.15); }
}
.la-thinking-meta {
  font-size: 11px;
  color: var(--lumiverse-text-muted, #9ea5bc);
}
.la-thinking-body {
  margin: 0;
  padding: 8px 10px;
  max-height: 150px;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  color: #c5cbe3;
  background: #141724;
}
.la-thinking-body[hidden] { display: none; }
.la-hud-corner {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: flex;
  gap: 4px;
  z-index: 2;
}
.la-hud-badge {
  position: absolute;
  left: 8px;
  top: 8px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(18, 20, 30, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #dbe0f2;
  pointer-events: none;
}

.la-tile-group { cursor: pointer; }
.la-tile-rect {
  transition: filter 120ms ease, stroke-width 120ms ease;
}
.la-tile-group:hover .la-tile-rect {
  filter: brightness(1.16);
}
.la-tile-selected .la-tile-rect {
  stroke: #ffffff !important;
  stroke-width: 0.75 !important;
}
.la-tile-current .la-tile-rect {
  stroke: #fde047 !important;
  stroke-width: 0.7 !important;
}
.la-tile-label {
  fill: #f7f8fc;
  font-weight: 700;
  pointer-events: none;
  paint-order: stroke;
  stroke: rgba(14, 16, 25, 0.85);
  stroke-width: 0.55;
  stroke-linejoin: round;
}
.la-tile-size {
  fill: #dbe2ff;
  font-weight: 600;
  opacity: 0.88;
  pointer-events: none;
  paint-order: stroke;
  stroke: rgba(14, 16, 25, 0.85);
  stroke-width: 0.45;
}
.la-pin-label {
  fill: #ffffff;
  font-weight: 700;
  pointer-events: none;
  paint-order: stroke;
  stroke: rgba(11, 13, 20, 0.95);
  stroke-width: 0.65;
  stroke-linejoin: round;
}

.la-inspector {
  border: 1px solid var(--lumiverse-border, #3e4359);
  border-radius: 10px;
  background: var(--lumiverse-fill-subtle, #1e2130);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.la-insp-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.la-insp-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--lumiverse-text, #f5f6fb);
}
.la-pill-row {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}
.la-pill {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 2px 7px;
  border-radius: 999px;
  background: #2b2f45;
  color: #cbd2eb;
  border: 1px solid rgba(255,255,255,0.08);
}
.la-pill-current { background: rgba(250, 204, 21, 0.18); color: #fde68a; border-color: rgba(250, 204, 21, 0.4); }
.la-pill-locked { background: rgba(244, 114, 182, 0.16); color: #fbcfe8; border-color: rgba(244, 114, 182, 0.35); }
.la-insp-summary {
  margin: 0;
  font-size: 12px;
  color: var(--lumiverse-text, #dce0f0);
}
.la-insp-section-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--lumiverse-text-muted, #98a0b8);
}
.la-feature-list {
  margin: 0;
  padding-left: 16px;
  display: grid;
  gap: 2px;
  font-size: 12px;
  color: #d0d6ec;
}
.la-chip-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.la-pin-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 999px;
  background: #262a3d;
  border: 1px solid rgba(255,255,255,0.1);
  font-size: 11px;
  color: #eef0f7;
}
.la-pin-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.la-neighbor-btn {
  appearance: none;
  border: 1px solid var(--lumiverse-border, #434861);
  background: #262a3d;
  color: #d6dcf5;
  border-radius: 6px;
  padding: 3px 8px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.la-neighbor-btn:hover {
  border-color: var(--lumiverse-primary, #9b8cff);
  color: #fff;
}
.la-notes {
  font-size: 11px;
  color: var(--lumiverse-text-muted, #9ca3bb);
  border-top: 1px solid rgba(255,255,255,0.08);
  padding-top: 6px;
}
`;
var STATE_VIEWS = [
  ["map", "Map"],
  ["world-scene", "World & Scene"],
  ["onscreen-thoughts", "Onscreen & Thoughts"],
  ["offscreen-agendas", "Offscreen Agendas"],
  ["profiles-memories", "Profiles & Memories"],
  ["relationships-reputation", "Relationships & Reputation"],
  ["plot-leads", "Plot & Leads"],
  ["inventory-notes", "Inventory & Notes"],
  ["ledger", "Ledger"]
];
var STATE_GROUPS = {
  "world-scene": [["world", "World"], ["locations", "Locations"]],
  "onscreen-thoughts": [["onscreen", "Onscreen"], ["thoughts", "Thoughts"]],
  "offscreen-agendas": [["offscreen_agendas", "Offscreen agendas"]],
  "profiles-memories": [["entity_state", "Profiles"], ["entityMem", "Memories"]],
  "relationships-reputation": [["dam", "Dynamics"], ["pair", "Relationships"], ["reputation", "Reputation"]],
  "plot-leads": [["tracks", "Tracks"], ["arc", "Arc"], ["chekhov", "Story threads"], ["leads", "Player-facing leads"]],
  "inventory-notes": [["inv", "Inventory"], ["story_notes", "Story notes"], ["notebook", "Notebook"], ["vent", "Vent"]]
};
function readInternalSnapshot(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const value = raw;
  if (!value.sections || typeof value.sections !== "object" || Array.isArray(value.sections))
    return null;
  const sections = Object.create(null);
  for (const [key, content] of Object.entries(value.sections)) {
    if (typeof content === "string")
      sections[key] = content;
  }
  return { sections, ledger: typeof value.ledger === "string" ? value.ledger : undefined };
}
var LEDGER_MARKUP = /(?:<|&lt;)\s*\/?\s*(?:(?:[\w.-]+:)?(?:details|ledger|activation)|ledger:[\w.-]+)\b|ldg-source/i;
var LEDGER_ELEMENT = /^(?:(?:[\w.-]+:)?(?:details|ledger|activation)|ledger:[\w.-]+)$/i;
function formatStateText(raw, omitLedger = false) {
  const input = raw.trim();
  if (!input || /<!\s*(?:DOCTYPE|ENTITY)/i.test(input))
    return input;
  try {
    const parser = new window.DOMParser;
    const parsed = parser.parseFromString(`<root xmlns:state="urn:lumi-atlas:state">${input}</root>`, "application/xml");
    if (parsed.querySelector("parsererror"))
      return input;
    const lines = [];
    const walk = (node, depth) => {
      if (omitLedger && LEDGER_ELEMENT.test(node.tagName))
        return;
      const label = node.tagName.replace(/^state:/, "").replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
      const children = Array.from(node.children);
      const indent = "  ".repeat(depth);
      if (!children.length) {
        const text = node.textContent?.trim();
        if (text)
          lines.push(`${indent}${label}: ${text}`);
        return;
      }
      lines.push(`${indent}${label}:`);
      for (const child of children)
        walk(child, depth + 1);
    };
    const root = parsed.documentElement;
    const elements = Array.from(root.children);
    if (!elements.length)
      return root.textContent?.trim() ?? input;
    for (const node of elements) {
      if (omitLedger && LEDGER_ELEMENT.test(node.tagName))
        continue;
      if (node.tagName.startsWith("state:")) {
        for (const child of Array.from(node.children))
          walk(child, 0);
        if (!node.children.length && node.textContent?.trim())
          lines.push(node.textContent.trim());
      } else {
        walk(node, 0);
      }
    }
    return lines.join(`
`) || "";
  } catch {
    return input;
  }
}
function revealedLedger(raw) {
  if (!raw?.trim() || /<!\s*(?:DOCTYPE|ENTITY)/i.test(raw))
    return null;
  try {
    const parsed = new window.DOMParser().parseFromString(`<root>${raw}</root>`, "application/xml");
    if (parsed.querySelector("parsererror"))
      return null;
    const top = Array.from(parsed.documentElement.children);
    if (top.length !== 1)
      return null;
    const ledger = top[0];
    if (ledger.tagName !== "details" || !ledger.classList.contains("ldg-source"))
      return null;
    if (ledger.getElementsByTagName("details").length)
      return null;
    const activations = Array.from(ledger.getElementsByTagName("activation"));
    if (activations.length !== 1 || activations[0].children.length || activations[0].textContent?.trim() !== "REVEALED")
      return null;
    return formatStateText(raw);
  } catch {
    return null;
  }
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className)
    node.className = className;
  if (text !== undefined)
    node.textContent = text;
  return node;
}
function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      node.setAttribute(k, String(v));
    }
  }
  return node;
}
function makeRequestId(ctx, fallbackCounter) {
  if (ctx.uuid && (ctx.host.capabilities["frontend-uuid-v1"] ?? 0) >= 1) {
    return ctx.uuid.v4();
  }
  return `la_req_${Date.now()}_${fallbackCounter}`;
}
function getVisibleTiles(layer, floor) {
  if (layer.scale !== "local")
    return layer.tiles;
  return layer.tiles.filter((t) => t.floor === floor);
}
function getFloors(layer) {
  if (layer.scale !== "local")
    return [0];
  const floors = Array.from(new Set(layer.tiles.map((t) => t.floor))).sort((a, b) => a - b);
  return floors.length ? floors : [0];
}
function wrapTextLines(raw, maxCharsPerLine, maxLines) {
  const text = raw.trim();
  if (!text)
    return [];
  const limit = Math.max(4, Math.floor(maxCharsPerLine));
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      if (word.length <= limit) {
        current = word;
      } else {
        lines.push(`${word.slice(0, Math.max(3, limit - 1))}…`);
      }
    } else if (current.length + 1 + word.length <= limit) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      if (word.length <= limit) {
        current = word;
      } else {
        current = `${word.slice(0, Math.max(3, limit - 1))}…`;
      }
    }
    if (lines.length >= maxLines)
      break;
  }
  if (lines.length < maxLines && current) {
    lines.push(current);
  }
  const consumed = lines.join(" ").replace(/…/g, "");
  if (lines.length === maxLines && consumed.length < text.length) {
    const last = lines[maxLines - 1];
    if (!last.endsWith("…")) {
      lines[maxLines - 1] = last.length >= limit ? `${last.slice(0, Math.max(3, limit - 1))}…` : `${last}…`;
    }
  }
  return lines.slice(0, maxLines);
}
function shortPinLabel(name, maxChars) {
  const clean = name.trim();
  if (clean.length <= maxChars)
    return clean;
  const first = clean.split(/\s+/)[0] || clean;
  if (first.length <= maxChars)
    return first;
  return `${first.slice(0, Math.max(3, maxChars - 1))}…`;
}
function layoutTilePins(tile) {
  const pins = tile.pins;
  if (!pins.length)
    return [];
  const ordered = [...pins].sort((a, b) => a.x - b.x);
  const maxPerRow = tile.w >= 25 ? 4 : tile.w >= 15 ? 3 : tile.w >= 10 ? 2 : 1;
  const rows = Math.ceil(ordered.length / maxPerRow);
  const placements = [];
  const bandTop = tile.y + tile.h * (rows > 1 ? 0.56 : 0.64);
  const bandBottom = tile.y + tile.h * 0.79;
  const bandHeight = Math.max(1.2, bandBottom - bandTop);
  for (let i = 0;i < ordered.length; i++) {
    const row = Math.floor(i / maxPerRow);
    const col = i % maxPerRow;
    const colsInRow = Math.min(maxPerRow, ordered.length - row * maxPerRow);
    const fracX = (col + 0.5) / colsInRow;
    const padX = Math.min(2.2, tile.w * 0.16);
    const usableW = Math.max(1, tile.w - padX * 2);
    const px = tile.x + padX + usableW * fracX;
    const py = rows === 1 ? bandTop + bandHeight * 0.45 : bandTop + bandHeight * (row + 0.5) / rows;
    placements.push({ pin: ordered[i], px, py, row, colsInRow });
  }
  return placements;
}
function setup(ctx) {
  let reqCounter = 0;
  let pendingRequestId = null;
  const cleanups = [];
  const tab = ctx.ui.registerDrawerTab({
    id: "atlas",
    title: "LumiAtlas",
    shortName: "Atlas",
    headerTitle: "Atlas Map",
    description: "3-layer background cartographic map (Local, Region, World)",
    keywords: ["map", "atlas", "world", "region", "local", "pins"],
    iconSvg: ATLAS_ICON_SVG
  });
  const removeStyle = ctx.dom.addStyle(STYLES);
  const state = {
    activeChatId: ctx.getActiveChat().chatId,
    config: { enabled: false, autoUpdate: true, connectionId: null, reasoningMode: "inherit" },
    connections: [],
    atlas: null,
    internalState: null,
    internalLoading: true,
    internalInvalid: false,
    archives: { local: [], region: [], world: [] },
    selectedLayerId: { local: null, region: null, world: null },
    scale: "local",
    view: "map",
    floor: 0,
    selectedTileId: null,
    busy: false,
    stream: null,
    thinkingOpen: true,
    statusMessage: "Loading Atlas…",
    error: null,
    settingsOpen: false,
    showPins: true,
    showRoads: true,
    showLabels: true,
    camera: { x: -50, y: -50, w: 100, h: 100 },
    cameraScaleKey: "",
    destroyed: false
  };
  const root = el("div", "la-root");
  const header = el("div", "la-header");
  const titleGroup = el("div", "la-title-group");
  const locationEl = el("div", "la-location", "LumiAtlas");
  const subtitleEl = el("div", "la-subtitle", "Loading…");
  titleGroup.append(locationEl, subtitleEl);
  const actions = el("div", "la-actions");
  const analyzeBtn = el("button", "la-btn la-btn-primary", "Analyze");
  const rebuildBtn = el("button", "la-btn", "Rebuild");
  const cancelBtn = el("button", "la-btn la-btn-danger", "Cancel");
  cancelBtn.hidden = true;
  const settingsBtn = el("button", "la-btn", "Settings");
  actions.append(analyzeBtn, rebuildBtn, cancelBtn, settingsBtn);
  header.append(titleGroup, actions);
  const settingsBox = el("div", "la-settings");
  settingsBox.hidden = true;
  const connField = el("label", "la-field", "Background Map Model (Connection)");
  const connSelect = el("select", "la-select");
  connField.append(connSelect);
  const toggles = el("div", "la-toggles");
  const enabledLabel = el("label", "la-check");
  const enabledInput = el("input");
  enabledInput.type = "checkbox";
  enabledLabel.append(enabledInput, document.createTextNode("Enable for this chat"));
  const autoLabel = el("label", "la-check");
  const autoInput = el("input");
  autoInput.type = "checkbox";
  autoLabel.append(autoInput, document.createTextNode("Auto-update after replies"));
  const reasoningLabel = el("label", "la-check");
  const reasoningInput = el("input");
  reasoningInput.type = "checkbox";
  reasoningLabel.append(reasoningInput, document.createTextNode("Show model thinking"));
  const refreshBtn = el("button", "la-btn", "Reload");
  toggles.append(enabledLabel, autoLabel, reasoningLabel, refreshBtn);
  settingsBox.append(connField, toggles);
  const errorBanner = el("div", "la-banner la-banner-error");
  errorBanner.hidden = true;
  const staleBanner = el("div", "la-banner la-banner-stale");
  staleBanner.hidden = true;
  const thinkingBox = el("div", "la-thinking");
  thinkingBox.hidden = true;
  const thinkingHead = el("div", "la-thinking-head");
  const thinkingTitle = el("div", "la-thinking-title");
  const thinkingDot = el("span", "la-thinking-dot la-pulse");
  const thinkingLabel = el("span", undefined, "Model thinking…");
  thinkingTitle.append(thinkingDot, thinkingLabel);
  const thinkingMeta = el("span", "la-thinking-meta", "");
  thinkingHead.append(thinkingTitle, thinkingMeta);
  const thinkingBody = el("pre", "la-thinking-body", "");
  thinkingBox.append(thinkingHead, thinkingBody);
  const browserNav = el("div", "la-browser-nav");
  const viewField = el("label", "la-field", "States view");
  const viewSelect = el("select", "la-select");
  viewSelect.setAttribute("aria-label", "States view");
  for (const [value, label] of STATE_VIEWS) {
    const option = el("option", undefined, label);
    option.value = value;
    viewSelect.append(option);
  }
  viewField.append(viewSelect);
  const scaleField = el("label", "la-field", "Map scale");
  const scaleSelect = el("select", "la-select");
  scaleSelect.setAttribute("aria-label", "Map scale");
  for (const [value, label] of [["local", "Local"], ["region", "Region"], ["world", "World"]]) {
    const option = el("option", undefined, label);
    option.value = value;
    scaleSelect.append(option);
  }
  scaleField.append(scaleSelect);
  const layerField = el("label", "la-field", "Zone map");
  const layerSelect = el("select", "la-select la-layer-select");
  layerSelect.setAttribute("aria-label", "Zone map");
  layerField.append(layerSelect);
  browserNav.append(viewField, scaleField, layerField);
  const toolbar = el("div", "la-toolbar");
  const layerTools = el("div", "la-layer-tools");
  const floorBar = el("div", "la-floors");
  const pinsToggle = el("button", "la-btn la-btn-active", "Pins");
  const roadsToggle = el("button", "la-btn la-btn-active", "Roads");
  const labelsToggle = el("button", "la-btn la-btn-active", "Labels");
  layerTools.append(floorBar, pinsToggle, roadsToggle, labelsToggle);
  toolbar.append(layerTools);
  const canvasWrap = el("div", "la-canvas-wrap");
  const svg = svgEl("svg", {
    class: "la-svg",
    viewBox: "-50 -50 100 100",
    preserveAspectRatio: "xMidYMid meet"
  });
  const hudBadge = el("div", "la-hud-badge", "Local");
  const hudCorner = el("div", "la-hud-corner");
  const zoomInBtn = el("button", "la-btn la-btn-icon", "+");
  zoomInBtn.title = "Zoom in";
  const zoomOutBtn = el("button", "la-btn la-btn-icon", "−");
  zoomOutBtn.title = "Zoom out";
  const fitBtn = el("button", "la-btn la-btn-icon", "Fit");
  fitBtn.title = "Fit map to view";
  hudCorner.append(zoomOutBtn, zoomInBtn, fitBtn);
  const emptyOverlay = el("div", "la-empty-overlay");
  canvasWrap.append(svg, hudBadge, hudCorner, emptyOverlay);
  const inspector = el("div", "la-inspector");
  const statePanel = el("section", "la-state-panel");
  statePanel.setAttribute("aria-live", "polite");
  statePanel.hidden = true;
  root.append(header, settingsBox, errorBanner, staleBanner, thinkingBox, browserNav, toolbar, canvasWrap, inspector, statePanel);
  tab.root.replaceChildren(root);
  function send(msg) {
    if (state.destroyed)
      return;
    ctx.sendToBackend(msg);
  }
  function requestInit() {
    const reqId = makeRequestId(ctx, ++reqCounter);
    pendingRequestId = reqId;
    const active = ctx.getActiveChat();
    state.activeChatId = active.chatId;
    send({ type: "init", requestId: reqId, chatId: active.chatId });
  }
  function availableLayers(scale) {
    const result = [];
    const seen = new Set;
    const active = state.atlas?.maps?.[scale];
    if (active && active.tiles.length > 0) {
      result.push(active);
      seen.add(active.id);
    }
    for (const archived of state.archives[scale] ?? []) {
      if (archived && archived.tiles.length > 0 && !seen.has(archived.id)) {
        result.push(archived);
        seen.add(archived.id);
      }
    }
    return result;
  }
  function reconcileSelectedLayers() {
    for (const scale of ["local", "region", "world"]) {
      const id = state.selectedLayerId[scale];
      if (id && !availableLayers(scale).some((layer) => layer.id === id))
        state.selectedLayerId[scale] = null;
    }
  }
  function currentLayer() {
    const active = state.atlas?.maps?.[state.scale] ?? null;
    const pickedId = state.selectedLayerId[state.scale];
    if (pickedId) {
      const list = availableLayers(state.scale);
      const match = list.find((l) => l.id === pickedId);
      if (match)
        return match;
    }
    return active;
  }
  function fitCamera(force = false) {
    const layer = currentLayer();
    const key = `${state.activeChatId ?? ""}:${state.scale}:${state.floor}:${layer?.id ?? ""}:${layer?.tiles.length ?? 0}`;
    if (!force && state.cameraScaleKey === key)
      return;
    const tiles = layer ? getVisibleTiles(layer, state.floor) : [];
    state.camera = computeViewBox(tiles, state.scale === "local" ? 6 : 8);
    state.cameraScaleKey = key;
    applyCamera();
  }
  function applyCamera() {
    const { x, y, w, h } = state.camera;
    svg.setAttribute("viewBox", `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
  }
  function zoom(factor) {
    const { x, y, w, h } = state.camera;
    const nw = Math.max(18, Math.min(320, w * factor));
    const nh = Math.max(18, Math.min(320, h * factor));
    state.camera = {
      x: x + (w - nw) / 2,
      y: y + (h - nh) / 2,
      w: nw,
      h: nh
    };
    applyCamera();
  }
  function renderMapSvg() {
    svg.replaceChildren();
    const layer = currentLayer();
    const tiles = layer ? getVisibleTiles(layer, state.floor) : [];
    if (!state.activeChatId) {
      hudBadge.textContent = "No Chat";
      emptyOverlay.hidden = false;
      emptyOverlay.replaceChildren(el("strong", undefined, "Open a roleplay chat"), el("span", undefined, "LumiAtlas tracks a separate 3-layer map per chat."));
      return;
    }
    hudBadge.textContent = layer && layer.tiles.length > 0 ? `${layer.name}${state.scale === "local" ? ` · F${state.floor}` : ""} (${tiles.length})` : state.scale.toUpperCase();
    if (!layer || tiles.length === 0) {
      emptyOverlay.hidden = false;
      emptyOverlay.replaceChildren(el("strong", undefined, `No ${state.scale} tiles yet`), el("span", undefined, state.config.connectionId ? "Click Analyze to generate your 3-layer Atlas." : "Open Settings to pick your background model (e.g. Terra), then click Analyze."));
      return;
    }
    emptyOverlay.hidden = true;
    fitCamera(false);
    const defs = svgEl("defs");
    const gridPat = svgEl("pattern", {
      id: "la-grid-pat",
      width: 5,
      height: 5,
      patternUnits: "userSpaceOnUse"
    });
    gridPat.append(svgEl("path", {
      d: "M 5 0 L 0 0 0 5",
      fill: "none",
      stroke: "rgba(255,255,255,0.045)",
      "stroke-width": 0.25
    }));
    const fogPat = svgEl("pattern", {
      id: "la-fog-pat",
      width: 4,
      height: 4,
      patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)"
    });
    fogPat.append(svgEl("rect", { width: 4, height: 4, fill: "#262938" }), svgEl("line", {
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 4,
      stroke: "rgba(255,255,255,0.12)",
      "stroke-width": 1.2
    }));
    defs.append(gridPat, fogPat);
    svg.append(defs);
    svg.append(svgEl("rect", {
      x: -300,
      y: -300,
      width: 600,
      height: 600,
      fill: "url(#la-grid-pat)"
    }));
    const tileById = new Map(tiles.map((t) => [t.id, t]));
    for (const tile of tiles) {
      const clip = svgEl("clipPath", { id: `la-clip-${tile.id}` });
      clip.append(svgEl("rect", {
        x: tile.x + 0.35,
        y: tile.y + 0.35,
        width: Math.max(0.5, tile.w - 0.7),
        height: Math.max(0.5, tile.h - 0.7),
        rx: state.scale === "local" ? 0.6 : 1
      }));
      defs.append(clip);
    }
    const tilesLayer = svgEl("g", { class: "la-layer-tiles" });
    for (const tile of tiles) {
      const isCurrent = layer.currentTileId === tile.id || tile.status === "current";
      const isSelected = state.selectedTileId === tile.id;
      const isFog = tile.status === "locked" || tile.status === "unexplored";
      const isRumored = tile.status === "rumored";
      const g = svgEl("g", {
        class: `la-tile-group${isCurrent ? " la-tile-current" : ""}${isSelected ? " la-tile-selected" : ""}`,
        "data-tile-id": tile.id
      });
      const fillColor = isFog ? "url(#la-fog-pat)" : defaultTileColor(tile, state.scale);
      const rect = svgEl("rect", {
        class: "la-tile-rect",
        x: tile.x,
        y: tile.y,
        width: tile.w,
        height: tile.h,
        rx: state.scale === "local" ? 0.8 : 1.2,
        fill: fillColor,
        stroke: isFog ? "#6b7280" : "rgba(255,255,255,0.28)",
        "stroke-width": state.scale === "local" ? 0.35 : 0.4
      });
      if (isRumored)
        rect.setAttribute("stroke-dasharray", "1.4 1.1");
      g.append(rect);
      if (!isFog) {
        g.append(svgEl("rect", {
          x: tile.x + 0.25,
          y: tile.y + 0.25,
          width: Math.max(0, tile.w - 0.5),
          height: Math.max(0, tile.h * 0.28),
          rx: state.scale === "local" ? 0.6 : 0.9,
          fill: "rgba(255,255,255,0.06)",
          "pointer-events": "none"
        }));
      }
      const titleTag = svgEl("title");
      titleTag.textContent = `${tile.name}${tile.sizeLabel ? ` (${tile.sizeLabel})` : ""}${tile.summary ? `
${tile.summary}` : ""}`;
      g.append(titleTag);
      g.addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.selectedTileId = tile.id;
        renderAll();
      });
      tilesLayer.append(g);
    }
    svg.append(tilesLayer);
    if (state.showRoads && layer.roads.length > 0) {
      const roadsLayer = svgEl("g", { class: "la-layer-roads", "pointer-events": "none", opacity: "0.82" });
      for (const road of layer.roads) {
        const a = tileById.get(road.from);
        const b = tileById.get(road.to);
        if (!a || !b)
          continue;
        const shared = findSharedEdge(a, b);
        if (state.scale === "local" && shared && road.kind === "door") {
          const doorLen = 2.2;
          const x1 = shared.orientation === "horizontal" ? shared.midX - doorLen / 2 : shared.midX;
          const y1 = shared.orientation === "vertical" ? shared.midY - doorLen / 2 : shared.midY;
          const x2 = shared.orientation === "horizontal" ? shared.midX + doorLen / 2 : shared.midX;
          const y2 = shared.orientation === "vertical" ? shared.midY + doorLen / 2 : shared.midY;
          roadsLayer.append(svgEl("line", {
            x1,
            y1,
            x2,
            y2,
            stroke: "#f5d08a",
            "stroke-width": 1.05,
            "stroke-linecap": "round"
          }));
        } else {
          const [x1, y1, x2, y2] = connectorSegment(a, b);
          const strokeColor = road.kind === "sea_route" ? "#60a5fa" : road.kind === "transit" ? "#c084fc" : road.kind === "stairs" ? "#fde047" : "#d4b47c";
          roadsLayer.append(svgEl("line", {
            x1,
            y1,
            x2,
            y2,
            stroke: "rgba(15,17,26,0.68)",
            "stroke-width": road.kind === "road" ? 1.2 : 0.88,
            "stroke-linecap": "round"
          }));
          const line = svgEl("line", {
            x1,
            y1,
            x2,
            y2,
            stroke: strokeColor,
            "stroke-width": road.kind === "road" ? 0.6 : 0.42,
            "stroke-linecap": "round"
          });
          if (road.kind === "path" || road.kind === "sea_route" || road.kind === "stairs") {
            line.setAttribute("stroke-dasharray", "1.3 1.0");
          }
          roadsLayer.append(line);
        }
      }
      svg.append(roadsLayer);
    }
    if (state.showLabels) {
      const labelsLayer = svgEl("g", { class: "la-layer-labels", "pointer-events": "none" });
      for (const tile of tiles) {
        const isFog = tile.status === "locked" || tile.status === "unexplored";
        const hasPins = state.showPins && tile.pins.length > 0;
        const labelZoneH = hasPins ? tile.h * 0.56 : tile.h * 0.86;
        const labelZoneTop = tile.y + (hasPins ? tile.h * 0.06 : tile.h * 0.07);
        const cx = tile.x + tile.w / 2;
        const usableW = Math.max(2.6, tile.w - 1.4);
        const baseFont = Math.max(0.95, Math.min(state.scale === "local" ? 1.95 : 2.35, usableW / 6.6, labelZoneH / (tile.sizeLabel && !isFog ? 3.8 : 2.6)));
        const maxChars = Math.max(4, Math.floor(usableW / (baseFont * 0.6)));
        const maxLines = labelZoneH >= baseFont * 4.2 ? 3 : labelZoneH >= baseFont * 2.5 ? 2 : 1;
        const rawLabel = isFog ? `\uD83D\uDD12 ${tile.name}` : tile.name;
        const lines = wrapTextLines(rawLabel, maxChars, maxLines);
        const lineHeight = baseFont * 1.18;
        const sizeFont = baseFont * 0.72;
        const showSize = Boolean(tile.sizeLabel && !isFog && labelZoneH >= lines.length * lineHeight + sizeFont * 1.4);
        const totalTextH = lines.length * lineHeight + (showSize ? sizeFont * 1.35 : 0);
        const startY = labelZoneTop + (labelZoneH - totalTextH) / 2 + baseFont * 0.88;
        const clippedGroup = svgEl("g", { "clip-path": `url(#la-clip-${tile.id})` });
        const labelEl = svgEl("text", {
          class: "la-tile-label",
          x: cx,
          y: startY.toFixed(2),
          "text-anchor": "middle",
          "font-size": baseFont.toFixed(2)
        });
        lines.forEach((lineText, idx) => {
          const tspan = svgEl("tspan", {
            x: cx,
            dy: idx === 0 ? "0" : lineHeight.toFixed(2)
          });
          tspan.textContent = lineText;
          labelEl.append(tspan);
        });
        clippedGroup.append(labelEl);
        if (showSize) {
          const sizeY = startY + (lines.length - 1) * lineHeight + sizeFont * 1.45;
          const sizeText = svgEl("text", {
            class: "la-tile-size",
            x: cx,
            y: sizeY.toFixed(2),
            "text-anchor": "middle",
            "font-size": sizeFont.toFixed(2)
          });
          sizeText.textContent = tile.sizeLabel;
          clippedGroup.append(sizeText);
        }
        labelsLayer.append(clippedGroup);
      }
      svg.append(labelsLayer);
    }
    if (state.showPins) {
      const pinsLayer = svgEl("g", { class: "la-layer-pins" });
      for (const tile of tiles) {
        if (!tile.pins.length)
          continue;
        const placements = layoutTilePins(tile);
        const tilePinGroup = svgEl("g", { "clip-path": `url(#la-clip-${tile.id})` });
        const dotBase = Math.max(0.55, Math.min(0.92, Math.min(tile.w, tile.h) * 0.055));
        const pinFont = Math.max(0.85, Math.min(1.28, tile.w / (Math.max(1, placements[0]?.colsInRow ?? 1) * 6.4)));
        for (const { pin, px, py, colsInRow } of placements) {
          const color = defaultPinColor(pin);
          const pinGroup = svgEl("g", { style: "cursor:pointer" });
          const dotR = pin.isPlayer ? dotBase * 1.18 : dotBase;
          if (pin.isPlayer) {
            pinGroup.append(svgEl("circle", {
              cx: px.toFixed(2),
              cy: py.toFixed(2),
              r: (dotR * 1.75).toFixed(2),
              fill: "rgba(254, 240, 138, 0.26)",
              stroke: "#fde047",
              "stroke-width": 0.24
            }));
          }
          pinGroup.append(svgEl("circle", {
            cx: px.toFixed(2),
            cy: py.toFixed(2),
            r: dotR.toFixed(2),
            fill: color,
            stroke: "#0f111a",
            "stroke-width": 0.28
          }));
          const slotW = Math.max(3, (tile.w - 1.2) / Math.max(1, colsInRow));
          const maxPinChars = Math.max(4, Math.floor(slotW / (pinFont * 0.6)));
          const pinLabel = svgEl("text", {
            class: "la-pin-label",
            x: px.toFixed(2),
            y: (py + dotR + pinFont * 1.05).toFixed(2),
            "text-anchor": "middle",
            "font-size": pinFont.toFixed(2)
          });
          pinLabel.textContent = shortPinLabel(pin.name, maxPinChars);
          pinGroup.append(pinLabel);
          const pinTitle = svgEl("title");
          pinTitle.textContent = `${pin.name}${pin.note ? ` — ${pin.note}` : ""}`;
          pinGroup.append(pinTitle);
          pinGroup.addEventListener("click", (ev) => {
            ev.stopPropagation();
            state.selectedTileId = tile.id;
            renderAll();
          });
          tilePinGroup.append(pinGroup);
        }
        pinsLayer.append(tilePinGroup);
      }
      svg.append(pinsLayer);
    }
  }
  function renderInspector() {
    inspector.replaceChildren();
    const layer = currentLayer();
    if (!layer || !layer.tiles.length) {
      inspector.append(el("div", "la-subtitle", "Select a tile after analyzing to inspect features, character pins, and routes."));
      return;
    }
    const visible = getVisibleTiles(layer, state.floor);
    const tile = visible.find((t) => t.id === state.selectedTileId) ?? visible.find((t) => t.id === layer.currentTileId) ?? visible[0];
    if (!tile)
      return;
    const head = el("div", "la-insp-head");
    head.append(el("div", "la-insp-title", tile.name));
    const pills = el("div", "la-pill-row");
    const statusClass = tile.status === "current" || layer.currentTileId === tile.id ? "la-pill la-pill-current" : tile.status === "locked" || tile.status === "unexplored" ? "la-pill la-pill-locked" : "la-pill";
    pills.append(el("span", statusClass, layer.currentTileId === tile.id ? "here" : tile.status));
    pills.append(el("span", "la-pill", tile.kind));
    if (tile.sizeLabel)
      pills.append(el("span", "la-pill", tile.sizeLabel));
    head.append(pills);
    inspector.append(head);
    if (tile.summary) {
      inspector.append(el("p", "la-insp-summary", tile.summary));
    }
    if (tile.features.length > 0 && tile.status !== "locked" && tile.status !== "unexplored") {
      inspector.append(el("div", "la-insp-section-label", "Features & Hooks"));
      const ul = el("ul", "la-feature-list");
      for (const feat of tile.features) {
        ul.append(el("li", undefined, feat));
      }
      inspector.append(ul);
    }
    if (tile.pins.length > 0) {
      inspector.append(el("div", "la-insp-section-label", "Characters Here"));
      const row = el("div", "la-chip-row");
      for (const pin of tile.pins) {
        const chip = el("span", "la-pin-chip");
        const dot = el("span", "la-pin-dot");
        dot.style.background = defaultPinColor(pin);
        chip.append(dot, document.createTextNode(pin.note ? `${pin.name} (${pin.note})` : pin.name));
        row.append(chip);
      }
      inspector.append(row);
    }
    const neighborIds = new Set(tile.connections);
    for (const road of layer.roads) {
      if (road.from === tile.id)
        neighborIds.add(road.to);
      if (road.to === tile.id)
        neighborIds.add(road.from);
    }
    const neighbors = Array.from(neighborIds).map((id) => layer.tiles.find((t) => t.id === id)).filter((t) => !!t);
    if (neighbors.length > 0) {
      inspector.append(el("div", "la-insp-section-label", "Connected Routes"));
      const row = el("div", "la-chip-row");
      for (const n of neighbors) {
        const btn = el("button", "la-neighbor-btn", n.floor !== tile.floor ? `${n.name} (F${n.floor})` : n.name);
        btn.type = "button";
        btn.addEventListener("click", () => {
          state.floor = n.floor;
          state.selectedTileId = n.id;
          fitCamera(true);
          renderAll();
        });
        row.append(btn);
      }
      inspector.append(row);
    }
    if (state.atlas?.notes && state.atlas.notes.length > 0) {
      inspector.append(el("div", "la-notes", state.atlas.notes.join(" · ")));
    }
  }
  function renderStatePanel() {
    statePanel.replaceChildren();
    statePanel.hidden = state.view === "map";
    if (state.view === "map")
      return;
    const title = STATE_VIEWS.find(([value]) => value === state.view)?.[1] ?? "States";
    statePanel.setAttribute("aria-label", title);
    statePanel.append(el("div", "la-insp-title", title));
    if (!state.activeChatId) {
      statePanel.append(el("p", "la-subtitle", "Open a chat to view its states."));
      return;
    }
    if (state.internalLoading) {
      statePanel.append(el("p", "la-subtitle", "Loading states…"));
      return;
    }
    if (state.internalInvalid || state.error && !state.internalState) {
      statePanel.append(el("p", "la-subtitle", "Unable to load states."));
      return;
    }
    if (!state.internalState) {
      statePanel.append(el("p", "la-subtitle", "No states available for this chat."));
      return;
    }
    if (state.view === "ledger") {
      const content = revealedLedger(state.internalState.ledger);
      statePanel.append(content ? el("pre", "la-state-text", content) : el("p", "la-subtitle", "No revealed Ledger available."));
      return;
    }
    for (const [key, label] of STATE_GROUPS[state.view]) {
      const section = el("section", "la-state-section");
      section.setAttribute("data-state-section", key);
      section.append(el("div", "la-insp-section-label", label));
      const raw = state.internalState.sections[key] ?? "";
      const containsLedger = LEDGER_MARKUP.test(raw);
      const content = formatStateText(raw, true);
      const unsafeFallback = containsLedger && LEDGER_MARKUP.test(content);
      section.append(el("pre", "la-state-text", unsafeFallback ? "Ledger-like content omitted; check the Ledger view." : content || "No data available."));
      statePanel.append(section);
    }
  }
  function renderAll() {
    if (state.destroyed)
      return;
    locationEl.textContent = state.atlas?.currentLocation && state.atlas.currentLocation !== "Unknown" ? state.atlas.currentLocation : "LumiAtlas";
    subtitleEl.textContent = state.statusMessage;
    const hasChat = !!state.activeChatId;
    const hasConn = !!state.config.connectionId;
    analyzeBtn.disabled = !hasChat || !hasConn || state.busy;
    rebuildBtn.disabled = !hasChat || !hasConn || state.busy;
    cancelBtn.hidden = !state.busy;
    settingsBtn.classList.toggle("la-btn-active", state.settingsOpen);
    settingsBox.hidden = !state.settingsOpen;
    connSelect.replaceChildren();
    const blank = el("option", undefined, state.connections.length ? "— Select a connection —" : "No connections available");
    blank.value = "";
    connSelect.append(blank);
    for (const c of state.connections) {
      const opt = el("option", undefined, c.model ? `${c.name} (${c.model})` : c.name);
      opt.value = c.id;
      connSelect.append(opt);
    }
    connSelect.value = state.config.connectionId ?? "";
    enabledInput.checked = state.config.enabled;
    enabledInput.disabled = !hasChat;
    autoInput.checked = state.config.autoUpdate;
    autoInput.disabled = !hasChat || !state.config.enabled;
    reasoningInput.checked = state.config.reasoningMode !== "off";
    errorBanner.hidden = !state.error;
    errorBanner.textContent = state.error ?? "";
    staleBanner.hidden = !state.atlas?.stale;
    staleBanner.textContent = state.atlas?.staleReason ?? "";
    const hasStream = state.busy || Boolean(state.stream && (state.stream.reasoning || state.stream.outputChars > 0));
    thinkingBox.hidden = !hasStream;
    if (hasStream) {
      const phase = state.stream?.phase ?? "thinking";
      const reasoningText = state.stream?.reasoning ?? "";
      const outChars = state.stream?.outputChars ?? 0;
      thinkingDot.classList.toggle("la-pulse", state.busy);
      if (state.busy) {
        thinkingLabel.textContent = phase === "writing" ? "Writing Atlas JSON…" : reasoningText ? "Model thinking…" : "Waiting for model…";
      } else {
        thinkingLabel.textContent = reasoningText ? "Last generation thoughts" : "Last generation output";
      }
      const metaParts = [];
      if (reasoningText)
        metaParts.push(`${reasoningText.length} thinking chars`);
      if (outChars > 0)
        metaParts.push(`${outChars} JSON chars`);
      metaParts.push(state.thinkingOpen ? "Hide" : "Show");
      thinkingMeta.textContent = metaParts.join(" · ");
      thinkingBody.hidden = !state.thinkingOpen;
      if (state.thinkingOpen) {
        if (reasoningText) {
          thinkingBody.textContent = reasoningText;
        } else if (state.stream?.outputTail) {
          thinkingBody.textContent = `Generating map JSON (${outChars} chars)…
${state.stream.outputTail}`;
        } else if (state.busy) {
          thinkingBody.textContent = state.config.reasoningMode === "off" ? "Streaming JSON directly (thinking disabled in Settings)…" : "Waiting for reasoning tokens from model…";
        } else {
          thinkingBody.textContent = "";
        }
        thinkingBody.scrollTop = thinkingBody.scrollHeight;
      }
    }
    viewSelect.value = state.view;
    scaleSelect.value = state.scale;
    const showMap = state.view === "map";
    scaleSelect.disabled = !showMap;
    toolbar.hidden = !showMap;
    canvasWrap.hidden = !showMap;
    inspector.hidden = !showMap;
    const layers = availableLayers(state.scale);
    layerSelect.disabled = !showMap || layers.length === 0;
    layerSelect.replaceChildren();
    if (!layers.length) {
      const empty = el("option", undefined, "No maps available");
      empty.value = "";
      layerSelect.append(empty);
    } else {
      const activeId = state.atlas?.maps?.[state.scale]?.id ?? null;
      for (const l of layers) {
        const isCurrent = l.id === activeId;
        const opt = el("option", undefined, `${l.name} (${l.tiles.length} ${l.tiles.length === 1 ? "tile" : "tiles"})${isCurrent ? " · Current" : ""}`);
        opt.value = l.id;
        layerSelect.append(opt);
      }
      const currentId = currentLayer()?.id ?? layers[0]?.id ?? "";
      layerSelect.value = currentId;
    }
    floorBar.replaceChildren();
    const layer = currentLayer();
    if (layer && state.scale === "local") {
      const floors = getFloors(layer);
      if (floors.length > 1) {
        for (const f of floors) {
          const btn = el("button", `la-btn${state.floor === f ? " la-btn-active" : ""}`, `F${f}`);
          btn.type = "button";
          btn.addEventListener("click", () => {
            state.floor = f;
            fitCamera(true);
            renderAll();
          });
          floorBar.append(btn);
        }
      }
    }
    pinsToggle.classList.toggle("la-btn-active", state.showPins);
    roadsToggle.classList.toggle("la-btn-active", state.showRoads);
    labelsToggle.classList.toggle("la-btn-active", state.showLabels);
    renderMapSvg();
    renderInspector();
    renderStatePanel();
  }
  const on = (target, type, handler) => {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  };
  on(settingsBtn, "click", () => {
    state.settingsOpen = !state.settingsOpen;
    renderAll();
  });
  on(connSelect, "change", () => {
    const val = connSelect.value || null;
    state.config.connectionId = val;
    state.error = null;
    send({ type: "set_connection", connectionId: val });
    renderAll();
  });
  on(enabledInput, "change", () => {
    if (!state.activeChatId)
      return;
    state.config.enabled = enabledInput.checked;
    send({
      type: "set_chat_config",
      chatId: state.activeChatId,
      enabled: state.config.enabled,
      autoUpdate: state.config.autoUpdate
    });
    renderAll();
  });
  on(autoInput, "change", () => {
    if (!state.activeChatId)
      return;
    state.config.autoUpdate = autoInput.checked;
    send({
      type: "set_chat_config",
      chatId: state.activeChatId,
      enabled: state.config.enabled,
      autoUpdate: state.config.autoUpdate
    });
    renderAll();
  });
  on(reasoningInput, "change", () => {
    const reasoningMode = reasoningInput.checked ? "inherit" : "off";
    state.config.reasoningMode = reasoningMode;
    send({ type: "set_reasoning_mode", reasoningMode });
    renderAll();
  });
  on(thinkingHead, "click", () => {
    state.thinkingOpen = !state.thinkingOpen;
    renderAll();
  });
  on(viewSelect, "change", () => {
    const view = STATE_VIEWS.find(([value]) => value === viewSelect.value);
    if (!view)
      return;
    state.view = view[0];
    renderAll();
  });
  on(layerSelect, "change", () => {
    const picked = layerSelect.value || null;
    if (!picked || !availableLayers(state.scale).some((layer) => layer.id === picked))
      return;
    const activeId = state.atlas?.maps?.[state.scale]?.id ?? null;
    state.selectedLayerId[state.scale] = picked === activeId ? null : picked;
    const layer = currentLayer();
    state.floor = layer?.activeFloor ?? 0;
    state.selectedTileId = layer?.currentTileId ?? null;
    fitCamera(true);
    renderAll();
  });
  on(refreshBtn, "click", () => {
    state.error = null;
    requestInit();
  });
  on(analyzeBtn, "click", () => {
    if (!state.activeChatId || state.busy)
      return;
    state.error = null;
    state.busy = true;
    state.stream = { phase: "thinking", reasoning: "", outputChars: 0, outputTail: "" };
    state.thinkingOpen = true;
    state.statusMessage = "Requesting Atlas update…";
    send({ type: "analyze", chatId: state.activeChatId, mode: "update" });
    renderAll();
  });
  on(rebuildBtn, "click", () => {
    if (!state.activeChatId || state.busy)
      return;
    state.error = null;
    state.busy = true;
    state.stream = { phase: "thinking", reasoning: "", outputChars: 0, outputTail: "" };
    state.thinkingOpen = true;
    state.statusMessage = "Requesting fresh 3-layer rebuild…";
    send({ type: "analyze", chatId: state.activeChatId, mode: "rebuild" });
    renderAll();
  });
  on(cancelBtn, "click", () => {
    if (!state.activeChatId)
      return;
    send({ type: "cancel", chatId: state.activeChatId });
  });
  on(scaleSelect, "change", () => {
    const scale = scaleSelect.value;
    if (scale !== "local" && scale !== "region" && scale !== "world" || state.scale === scale)
      return;
    state.scale = scale;
    const layer = currentLayer();
    state.selectedTileId = layer?.currentTileId ?? null;
    state.floor = layer?.activeFloor ?? 0;
    fitCamera(true);
    renderAll();
  });
  on(pinsToggle, "click", () => {
    state.showPins = !state.showPins;
    renderAll();
  });
  on(roadsToggle, "click", () => {
    state.showRoads = !state.showRoads;
    renderAll();
  });
  on(labelsToggle, "click", () => {
    state.showLabels = !state.showLabels;
    renderAll();
  });
  on(zoomInBtn, "click", () => zoom(0.78));
  on(zoomOutBtn, "click", () => zoom(1.28));
  on(fitBtn, "click", () => fitCamera(true));
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let camStartX = 0;
  let camStartY = 0;
  on(canvasWrap, "pointerdown", (ev) => {
    if (ev.button !== 0 || ev.target?.closest("button"))
      return;
    dragging = true;
    dragStartX = ev.clientX;
    dragStartY = ev.clientY;
    camStartX = state.camera.x;
    camStartY = state.camera.y;
    canvasWrap.classList.add("la-dragging");
    try {
      canvasWrap.setPointerCapture(ev.pointerId);
    } catch {}
  });
  on(canvasWrap, "pointermove", (ev) => {
    if (!dragging)
      return;
    const rect = canvasWrap.getBoundingClientRect();
    if (!rect.width || !rect.height)
      return;
    const scaleX = state.camera.w / rect.width;
    const scaleY = state.camera.h / rect.height;
    state.camera.x = camStartX - (ev.clientX - dragStartX) * scaleX;
    state.camera.y = camStartY - (ev.clientY - dragStartY) * scaleY;
    applyCamera();
  });
  const endDrag = () => {
    dragging = false;
    canvasWrap.classList.remove("la-dragging");
  };
  on(canvasWrap, "pointerup", endDrag);
  on(canvasWrap, "pointercancel", endDrag);
  on(canvasWrap, "wheel", (ev) => {
    ev.preventDefault();
    zoom(ev.deltaY > 0 ? 1.14 : 0.88);
  });
  const unsubBackend = ctx.onBackendMessage((raw) => {
    if (state.destroyed || !raw || typeof raw !== "object")
      return;
    const msg = raw;
    if (msg.type === "init") {
      if (pendingRequestId && msg.requestId && msg.requestId !== pendingRequestId)
        return;
      if (msg.activeChatId !== state.activeChatId)
        return;
      pendingRequestId = null;
      state.activeChatId = msg.activeChatId;
      state.config = msg.config;
      state.connections = msg.connections;
      state.atlas = msg.state;
      if (msg.internalState !== undefined) {
        state.internalState = readInternalSnapshot(msg.internalState);
        state.internalInvalid = msg.internalState !== null && !state.internalState;
      }
      state.internalLoading = false;
      state.archives = msg.archives ?? { local: [], region: [], world: [] };
      reconcileSelectedLayers();
      state.busy = msg.busy;
      if (!msg.busy)
        state.stream = null;
      state.statusMessage = msg.statusMessage;
      state.error = msg.error;
      if (!msg.config.connectionId)
        state.settingsOpen = true;
      const layer = currentLayer();
      const validFloors = layer ? getFloors(layer) : [];
      if (!validFloors.includes(state.floor))
        state.floor = layer?.activeFloor ?? 0;
      if (!layer?.tiles.some((tile) => tile.id === state.selectedTileId)) {
        state.selectedTileId = layer?.currentTileId ?? null;
      }
      fitCamera(false);
      renderAll();
      return;
    }
    if (msg.type === "stream") {
      if (!state.activeChatId || msg.chatId !== state.activeChatId)
        return;
      state.busy = true;
      state.stream = {
        phase: msg.phase,
        reasoning: msg.reasoning,
        outputChars: msg.outputChars,
        outputTail: msg.outputTail
      };
      renderAll();
      return;
    }
    if (msg.type === "status") {
      if (msg.chatId && msg.chatId !== state.activeChatId)
        return;
      if (msg.internalState !== undefined) {
        state.internalState = readInternalSnapshot(msg.internalState);
        state.internalInvalid = msg.internalState !== null && !state.internalState;
        state.internalLoading = false;
      }
      if (msg.status === "error")
        state.internalLoading = false;
      if (msg.config)
        state.config = msg.config;
      if (msg.archives)
        state.archives = msg.archives;
      if (msg.state !== undefined) {
        state.atlas = msg.state;
        reconcileSelectedLayers();
        const layer = currentLayer();
        if (!layer?.tiles.some((tile) => tile.id === state.selectedTileId)) {
          state.selectedTileId = layer?.currentTileId ?? null;
        }
      }
      if (msg.archives && msg.state === undefined)
        reconcileSelectedLayers();
      state.busy = msg.status === "updating";
      state.statusMessage = msg.message;
      state.error = msg.status === "error" ? msg.message : null;
      if (msg.status === "ready") {
        tab.setBadge(null);
        if (state.stream && !state.stream.reasoning) {
          state.stream = null;
        } else if (state.stream) {
          state.thinkingOpen = false;
        }
        fitCamera(false);
      } else if (msg.status === "updating") {
        tab.setBadge("…");
      } else if (msg.status === "stale") {
        tab.setBadge("!");
      } else if (msg.status === "idle" || msg.status === "error") {
        tab.setBadge(null);
      }
      renderAll();
    }
  });
  const unsubChat = ctx.events.on("CHAT_SWITCHED", (payload) => {
    const nextId = payload && typeof payload === "object" && typeof payload.chatId === "string" ? payload.chatId : null;
    state.activeChatId = nextId;
    state.atlas = null;
    state.internalState = null;
    state.internalLoading = !!nextId;
    state.internalInvalid = false;
    state.archives = { local: [], region: [], world: [] };
    state.selectedLayerId = { local: null, region: null, world: null };
    state.selectedTileId = null;
    state.busy = false;
    state.stream = null;
    thinkingBody.textContent = "";
    state.floor = 0;
    tab.setBadge(null);
    state.error = null;
    state.statusMessage = nextId ? "Loading Atlas…" : "Open a chat to view its Atlas.";
    state.cameraScaleKey = "";
    renderAll();
    requestInit();
  });
  const unsubActivate = tab.onActivate(() => {
    requestInit();
  });
  renderAll();
  requestInit();
  return () => {
    state.destroyed = true;
    for (const off of cleanups)
      off();
    unsubActivate();
    unsubChat();
    unsubBackend();
    removeStyle();
    tab.destroy();
  };
}
export {
  setup
};
