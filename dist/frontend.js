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
  gap: 8px;
  padding: 10px;
  height: 100%;
  min-height: 0;
  color: #e8e4df;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 12px;
  line-height: 1.45;
  background: #0f0d0b;
}
.la-root * { box-sizing: border-box; }

/* ── Header ── */
.la-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
  padding-bottom: 6px;
  border-bottom: 1px solid #2a2520;
}
.la-title-group { display: flex; flex-direction: column; min-width: 0; }
.la-location { font-size: 13px; font-weight: 700; color: #f0ebe4; }
.la-subtitle { font-size: 10px; color: #8a8078; }
.la-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.la-btn {
  appearance: none;
  border: 1px solid #3a332a;
  background: #1a1612;
  color: #d4ccc0;
  border-radius: 6px;
  padding: 3px 8px;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 100ms, background 100ms;
}
.la-btn:hover:not(:disabled) { border-color: #c4973c; background: #252018; }
.la-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.la-btn[hidden] { display: none; }
.la-btn-primary { background: #2a2318; border-color: #c4973c; color: #e8d5a0; }
.la-btn-primary:hover:not(:disabled) { background: #3a2e20; border-color: #e8b84e; }
.la-btn-danger { border-color: #8a4040; color: #e89898; }
.la-btn-icon { padding: 3px 6px; min-width: 24px; text-align: center; }
.la-btn-active { border-color: #c4973c; background: rgba(196,151,60,0.12); }

/* ── Settings ── */
.la-settings { display: grid; gap: 6px; padding: 8px 10px; border: 1px solid #2a2520; border-radius: 8px; background: #14110e; }
.la-settings[hidden] { display: none; }
.la-field { display: flex; flex-direction: column; gap: 3px; font-size: 10px; font-weight: 600; color: #8a8078; }
.la-select { width: 100%; padding: 4px 6px; border-radius: 5px; border: 1px solid #3a332a; background: #0f0d0b; color: #d4ccc0; font: inherit; font-size: 11px; }
.la-toggles { display: flex; gap: 10px; flex-wrap: wrap; }
.la-check { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 500; cursor: pointer; color: #c4bcb0; }
.la-check input { accent-color: #c4973c; width: 13px; height: 13px; margin: 0; }

/* ── Banners ── */
.la-banner { padding: 5px 8px; border-radius: 6px; font-size: 11px; border: 1px solid #3a332a; background: #1a1612; }
.la-banner[hidden] { display: none; }
.la-banner-error { border-color: #8a4040; background: rgba(138,64,64,0.1); color: #e8a0a0; }
.la-banner-stale { border-color: #c4973c; background: rgba(196,151,60,0.08); color: #e8d5a0; }

/* ── Thinking ── */
.la-thinking { border: 1px solid #2a2520; border-radius: 8px; background: #14110e; overflow: hidden; }
.la-thinking[hidden] { display: none; }
.la-thinking-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 5px 8px; background: rgba(196,151,60,0.06); border-bottom: 1px solid #2a2520; cursor: pointer; user-select: none; }
.la-thinking-title { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; color: #d4c4a0; }
.la-thinking-dot { width: 5px; height: 5px; border-radius: 50%; background: #c4973c; flex: none; }
.la-thinking-dot.la-pulse { animation: la-pulse 1.2s ease-in-out infinite; }
@keyframes la-pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
.la-thinking-meta { font-size: 10px; color: #8a8078; }
.la-thinking-body { margin: 0; padding: 6px 8px; max-height: 100px; overflow-y: auto; font-family: ui-monospace, monospace; font-size: 10px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; color: #a09890; background: #0f0d0b; }
.la-thinking-body[hidden] { display: none; }

/* ── Three-section browser ── */
.la-browser { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.la-section {
  border: 1px solid #2a2520;
  border-radius: 8px;
  background: #14110e;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.la-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 8px;
  background: rgba(196,151,60,0.05);
  border-bottom: 1px solid #2a2520;
}
.la-section-title { font-size: 11px; font-weight: 700; color: #d4c4a0; display: flex; align-items: center; gap: 5px; }
.la-section-icon { font-size: 12px; }
.la-section-body { flex: 1; min-height: 0; overflow-y: auto; }

/* ── Status badges ── */
.la-status-bar {
  display: flex; gap: 4px; flex-wrap: wrap; padding: 5px 8px;
  border-bottom: 1px solid #2a2520;
}
.la-status-badge {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 6px; border-radius: 4px;
  background: #1a1612; border: 1px solid #2a2520;
  font-size: 10px; color: #b0a898;
}
.la-status-badge .la-icon { font-size: 10px; }

/* ── Sidebar + Content layout ── */
.la-state-layout {
  display: flex; min-height: 0; flex: 1;
}
.la-sidebar {
  width: 110px; flex: none;
  border-right: 1px solid #2a2520;
  overflow-y: auto;
  padding: 4px 0;
}
.la-sidebar-category {
  padding: 4px 8px 2px;
  font-size: 9px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: #6a6058;
}
.la-sidebar-item {
  display: flex; align-items: center; gap: 5px;
  padding: 3px 8px; cursor: pointer;
  font-size: 11px; color: #a09890;
  border-left: 2px solid transparent;
  transition: background 80ms, border-color 80ms;
}
.la-sidebar-item:hover { background: rgba(196,151,60,0.06); }
.la-sidebar-item.la-active {
  background: rgba(196,151,60,0.1);
  border-left-color: #c4973c;
  color: #e8d5a0;
}
.la-sidebar-icon { width: 14px; text-align: center; flex: none; font-size: 11px; }
.la-state-content {
  flex: 1; min-width: 0;
  overflow-y: auto;
  padding: 6px;
}

/* ── Collapsible cards ── */
.la-card {
  margin-bottom: 4px;
  border: 1px solid #2a2520;
  border-radius: 6px;
  background: #1a1612;
  overflow: hidden;
}
.la-card-head {
  display: flex; align-items: center; gap: 5px;
  padding: 4px 8px;
  cursor: pointer;
  transition: background 80ms;
}
.la-card-head:hover { background: rgba(196,151,60,0.04); }
.la-card-head.la-expanded {
  border-bottom: 1px solid #2a2520;
  background: rgba(196,151,60,0.06);
}
.la-card-chevron {
  font-size: 10px; color: #c4973c;
  transition: transform 100ms;
  width: 12px; text-align: center;
}
.la-card-head.la-expanded .la-card-chevron { transform: rotate(90deg); }
.la-card-head.la-flat { cursor: default; }
.la-card-head.la-flat:hover { background: transparent; }
.la-card-dot { width: 5px; height: 5px; border-radius: 50%; flex: none; }
.la-card-name { font-weight: 700; font-size: 11px; color: #e0d8cc; flex: 1; }
.la-card-badge {
  font-size: 9px; font-weight: 600;
  padding: 0 5px; border-radius: 3px;
  background: #252018; border: 1px solid #3a332a;
  color: #b0a090;
}
.la-card-body { padding: 6px 8px; }
.la-card-detail {
  margin-top: 4px;
  padding: 4px 6px;
  background: rgba(196,151,60,0.03);
  border-radius: 4px;
  border: 1px solid #252018;
}
.la-card-detail-title {
  font-size: 9px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: #8a8078; margin-bottom: 2px;
}
.la-card-detail-text { font-size: 11px; color: #c4bcb0; }
.la-card-fields { display: grid; gap: 2px; }
.la-card-field { display: flex; gap: 4px; }
.la-card-field-label { font-weight: 600; color: #8a8078; min-width: 60px; flex: none; font-size: 10px; }
.la-card-field-value { color: #c4bcb0; font-size: 11px; }
.la-card-location { font-size: 10px; color: #8a8078; margin-bottom: 4px; }

/* ── Location cards (Rendered style) ── */
.la-location-card {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px; margin-bottom: 3px;
  border: 1px solid #2a2520; border-radius: 6px;
  background: #1a1612;
  border-left: 2px solid #c4973c;
}
.la-location-icon { font-size: 12px; }
.la-location-name { font-weight: 700; font-size: 11px; color: #e0d8cc; flex: 1; }
.la-location-id { font-family: monospace; font-size: 9px; color: #6a6058; }
.la-location-badge {
  font-size: 9px; font-weight: 600;
  padding: 0 5px; border-radius: 3px;
  background: rgba(196,151,60,0.1); border: 1px solid #c4973c;
  color: #d4b44e;
}

/* ── Map section ── */
.la-map-controls { display: flex; gap: 4px; padding: 5px 8px; flex-wrap: wrap; align-items: center; }
.la-map-controls .la-field { flex: 1; min-width: 80px; }
.la-canvas-wrap {
  position: relative; width: 100%;
  aspect-ratio: 4 / 3;
  min-height: 180px; max-height: 360px;
  border-top: 1px solid #2a2520;
  overflow: hidden;
  background: radial-gradient(circle at 50% 45%, #1a1612 0%, #0f0d0b 100%);
  touch-action: none; user-select: none;
}
.la-canvas-wrap.la-dragging { cursor: grabbing; }
.la-canvas-wrap:not(.la-dragging) { cursor: grab; }
.la-svg { width: 100%; height: 100%; display: block; }
.la-empty-overlay {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; padding: 16px; text-align: center;
  color: #8a8078; background: rgba(15,13,11,0.72);
  pointer-events: none;
}
.la-empty-overlay[hidden] { display: none; }
.la-empty-overlay strong { color: #d4ccc0; font-size: 12px; }
.la-hud-corner { position: absolute; right: 6px; bottom: 6px; display: flex; gap: 3px; z-index: 2; }
.la-hud-badge { position: absolute; left: 6px; top: 6px; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; background: rgba(15,13,11,0.82); border: 1px solid #2a2520; color: #b0a898; pointer-events: none; }

.la-tile-group { cursor: pointer; }
.la-tile-rect { transition: filter 100ms; }
.la-tile-group:hover .la-tile-rect { filter: brightness(1.15); }
.la-tile-selected .la-tile-rect { stroke: #e8d5a0 !important; stroke-width: 0.7 !important; }
.la-tile-current .la-tile-rect { stroke: #c4973c !important; stroke-width: 0.6 !important; }
.la-tile-label { fill: #e8e4df; font-weight: 700; pointer-events: none; paint-order: stroke; stroke: rgba(15,13,11,0.85); stroke-width: 0.5; stroke-linejoin: round; }
.la-tile-size { fill: #b0a898; font-weight: 600; opacity: 0.88; pointer-events: none; paint-order: stroke; stroke: rgba(15,13,11,0.85); stroke-width: 0.4; }
.la-pin-label { fill: #e8e4df; font-weight: 700; pointer-events: none; paint-order: stroke; stroke: rgba(15,13,11,0.9); stroke-width: 0.6; stroke-linejoin: round; }

.la-map-toolbar { display: flex; align-items: center; gap: 3px; padding: 4px 8px; flex-wrap: wrap; border-top: 1px solid #2a2520; }
.la-floors { display: inline-flex; gap: 3px; align-items: center; }
.la-inspector { padding: 6px 8px; border-top: 1px solid #2a2520; display: flex; flex-direction: column; gap: 4px; }
.la-insp-head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; flex-wrap: wrap; }
.la-insp-title { font-size: 12px; font-weight: 700; color: #f0ebe4; }
.la-pill-row { display: flex; gap: 3px; flex-wrap: wrap; }
.la-pill { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 5px; border-radius: 3px; background: #252018; color: #b0a090; border: 1px solid #3a332a; }
.la-pill-current { background: rgba(196,151,60,0.12); color: #d4b44e; border-color: #c4973c; }
.la-pill-locked { background: rgba(244,114,182,0.1); color: #f0a0c0; border-color: #8a4060; }
.la-insp-summary { margin: 0; font-size: 11px; color: #c4bcb0; }
.la-insp-section-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #6a6058; }
.la-feature-list { margin: 0; padding-left: 12px; display: grid; gap: 1px; font-size: 11px; color: #b0a898; }
.la-chip-row { display: flex; gap: 4px; flex-wrap: wrap; }
.la-pin-chip { display: inline-flex; align-items: center; gap: 3px; padding: 1px 5px; border-radius: 4px; background: #252018; border: 1px solid #3a332a; font-size: 10px; color: #d4ccc0; }
.la-pin-dot { width: 5px; height: 5px; border-radius: 50%; flex: none; }
.la-neighbor-btn { appearance: none; border: 1px solid #3a332a; background: #252018; color: #c4bcb0; border-radius: 4px; padding: 1px 5px; font: inherit; font-size: 10px; cursor: pointer; }
.la-neighbor-btn:hover { border-color: #c4973c; color: #e8d5a0; }
.la-notes { font-size: 10px; color: #6a6058; border-top: 1px solid #2a2520; padding-top: 4px; }

/* ── Ledger ── */
.la-ledger-body { padding: 6px 8px; }
.la-ledger-empty { color: #6a6058; font-size: 11px; text-align: center; padding: 10px; }
.la-ledger-content { font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; color: #c4bcb0; }
`;
var STATE_SECTIONS = [
  { id: "world", label: "World", icon: "\uD83C\uDF0D", category: "Scene", color: "#4e7a8c", collapsible: false },
  { id: "onscreen", label: "On-Screen", icon: "\uD83D\uDC64", category: "Scene", color: "#8b5a7c", collapsible: true },
  { id: "offscreen_agendas", label: "Off-Screen", icon: "\uD83C\uDF19", category: "Scene", color: "#c4973c", collapsible: true },
  { id: "locations", label: "Locations", icon: "\uD83D\uDCCD", category: "Scene", color: "#e86a6a", collapsible: true },
  { id: "entityMem", label: "Memory", icon: "\uD83E\uDDE0", category: "People", color: "#e86a8a", collapsible: true },
  { id: "entity_state", label: "Profile", icon: "\uD83E\uDEAA", category: "People", color: "#6a8ae8", collapsible: true },
  { id: "thoughts", label: "Thoughts", icon: "\uD83D\uDCAD", category: "People", color: "#a0a0a0", collapsible: true },
  { id: "dam", label: "Dams", icon: "\uD83E\uDEB5", category: "Relationships", color: "#8a6a4a", collapsible: true },
  { id: "pair", label: "Pairs", icon: "\uD83D\uDC9A", category: "Relationships", color: "#4ade80", collapsible: true },
  { id: "reputation", label: "Reputation", icon: "⭐", category: "Relationships", color: "#e8c44e", collapsible: true },
  { id: "tracks", label: "Tracks", icon: "\uD83E\uDDF5", category: "Plot", color: "#c084fc", collapsible: false },
  { id: "arc", label: "Arc", icon: "\uD83D\uDCD6", category: "Plot", color: "#fb923c", collapsible: false },
  { id: "chekhov", label: "Chekhov", icon: "\uD83D\uDD2B", category: "Plot", color: "#f87171", collapsible: false },
  { id: "leads", label: "Leads", icon: "\uD83D\uDD0D", category: "Plot", color: "#60a5fa", collapsible: false },
  { id: "inv", label: "Inventory", icon: "\uD83C\uDF92", category: "Other", color: "#a3a3a3", collapsible: false },
  { id: "story_notes", label: "Story Notes", icon: "\uD83D\uDCDD", category: "Other", color: "#a3a3a3", collapsible: false },
  { id: "notebook", label: "Notebook", icon: "\uD83D\uDCD3", category: "Other", color: "#a3a3a3", collapsible: false },
  { id: "vent", label: "Vent", icon: "\uD83D\uDCA8", category: "Other", color: "#a3a3a3", collapsible: false }
];
var CATEGORIES = ["Scene", "People", "Relationships", "Plot", "Other"];
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
function parseStateRecords(raw) {
  const input = raw.trim();
  if (!input)
    return [];
  try {
    const parser = new window.DOMParser;
    const parsed = parser.parseFromString(`<root xmlns:state="urn:lumi-atlas:state">${input}</root>`, "application/xml");
    if (parsed.querySelector("parsererror"))
      return [{ name: "Raw", fields: [], details: [], rawText: input }];
    const records = [];
    const root = parsed.documentElement;
    const stateEl = Array.from(root.children).find((el) => el.tagName.startsWith("state:") && !LEDGER_ELEMENT.test(el.tagName));
    if (!stateEl) {
      const anyState = Array.from(root.children).find((el) => el.tagName.startsWith("state:"));
      if (anyState && LEDGER_ELEMENT.test(anyState.tagName))
        return [];
      return [{ name: "Raw", fields: [], details: [], rawText: input }];
    }
    const children = Array.from(stateEl.children).filter((el) => !LEDGER_ELEMENT.test(el.tagName));
    if (!children.length) {
      const clone = stateEl.cloneNode(true);
      for (const el of Array.from(clone.querySelectorAll("*"))) {
        if (LEDGER_ELEMENT.test(el.tagName))
          el.remove();
      }
      const text = clone.textContent?.trim();
      return text ? [{ name: stateEl.tagName.replace(/^state:/, ""), fields: [], details: [], rawText: text }] : [];
    }
    for (const record of children) {
      const fields = [];
      const details = [];
      let name = record.tagName.replace(/_/g, " ");
      let badge;
      let location;
      for (const child of Array.from(record.children)) {
        if (LEDGER_ELEMENT.test(child.tagName))
          continue;
        const label = child.tagName.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
        const value = child.textContent?.trim() ?? "";
        if (!value)
          continue;
        if (child.tagName === "name" || child.tagName === "names" || child.tagName === "pair") {
          name = value;
        } else if (child.tagName === "loc" || child.tagName === "location") {
          location = value;
        } else if (["mode", "standing", "status", "salience", "sig"].includes(child.tagName)) {
          badge = child.tagName === "sig" ? `SIG ${value}` : value;
        } else if (["agenda", "why", "goal", "end", "move", "parrott", "residualMood", "tfdy"].includes(child.tagName)) {
          details.push({ title: child.tagName.toUpperCase(), text: value });
        } else {
          fields.push({ label, value });
        }
      }
      if (name === record.tagName.replace(/_/g, " ") && !record.children.length) {
        name = record.textContent?.trim()?.slice(0, 40) ?? name;
      }
      records.push({ name, badge, location, fields, details, rawText: "" });
    }
    return records.length ? records : [{ name: "Data", fields: [], details: [], rawText: formatStateText(input) }];
  } catch {
    return [{ name: "Raw", fields: [], details: [], rawText: input }];
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
  if (attrs)
    for (const [k, v] of Object.entries(attrs))
      node.setAttribute(k, String(v));
  return node;
}
function makeRequestId(ctx, fallbackCounter) {
  if (ctx.uuid && (ctx.host.capabilities["frontend-uuid-v1"] ?? 0) >= 1)
    return ctx.uuid.v4();
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
      if (word.length <= limit)
        current = word;
      else
        lines.push(`${word.slice(0, Math.max(3, limit - 1))}…`);
    } else if (current.length + 1 + word.length <= limit) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      if (word.length <= limit)
        current = word;
      else
        current = `${word.slice(0, Math.max(3, limit - 1))}…`;
    }
    if (lines.length >= maxLines)
      break;
  }
  if (lines.length < maxLines && current)
    lines.push(current);
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
    description: "Background simulation: states, map, and ledger",
    keywords: ["map", "atlas", "world", "region", "local", "pins", "states", "simulation"],
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
    stateSection: "world",
    expandedCards: new Set,
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
  const connField = el("label", "la-field", "Background Model");
  const connSelect = el("select", "la-select");
  connField.append(connSelect);
  const toggles = el("div", "la-toggles");
  const enabledLabel = el("label", "la-check");
  const enabledInput = el("input");
  enabledInput.type = "checkbox";
  enabledLabel.append(enabledInput, document.createTextNode("Enable"));
  const autoLabel = el("label", "la-check");
  const autoInput = el("input");
  autoInput.type = "checkbox";
  autoLabel.append(autoInput, document.createTextNode("Auto-update"));
  const reasoningLabel = el("label", "la-check");
  const reasoningInput = el("input");
  reasoningInput.type = "checkbox";
  reasoningLabel.append(reasoningInput, document.createTextNode("Thinking"));
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
  const browser = el("div", "la-browser");
  const mapSection = el("div", "la-section la-map-section");
  const mapHead = el("div", "la-section-head");
  const mapTitle = el("div", "la-section-title");
  mapTitle.append(el("span", "la-section-icon", "\uD83D\uDDFA"), el("span", undefined, "Map"));
  mapHead.append(mapTitle);
  const mapControls = el("div", "la-map-controls");
  const scaleField = el("label", "la-field", "Scale");
  const scaleSelect = el("select", "la-select");
  scaleSelect.setAttribute("aria-label", "Map scale");
  for (const [value, label] of [["local", "Local"], ["region", "Region"], ["world", "World"]]) {
    const opt = el("option", undefined, label);
    opt.value = value;
    scaleSelect.append(opt);
  }
  scaleField.append(scaleSelect);
  const zoneField = el("label", "la-field", "Zone");
  const zoneSelect = el("select", "la-select");
  zoneSelect.setAttribute("aria-label", "Zone map");
  zoneField.append(zoneSelect);
  mapControls.append(scaleField, zoneField);
  const canvasWrap = el("div", "la-canvas-wrap");
  const svg = svgEl("svg", { class: "la-svg", viewBox: "-50 -50 100 100", preserveAspectRatio: "xMidYMid meet" });
  const hudBadge = el("div", "la-hud-badge", "Local");
  const hudCorner = el("div", "la-hud-corner");
  const zoomInBtn = el("button", "la-btn la-btn-icon", "+");
  zoomInBtn.title = "Zoom in";
  const zoomOutBtn = el("button", "la-btn la-btn-icon", "−");
  zoomOutBtn.title = "Zoom out";
  const fitBtn = el("button", "la-btn la-btn-icon", "Fit");
  fitBtn.title = "Fit map";
  hudCorner.append(zoomOutBtn, zoomInBtn, fitBtn);
  const emptyOverlay = el("div", "la-empty-overlay");
  canvasWrap.append(svg, hudBadge, hudCorner, emptyOverlay);
  const mapToolbar = el("div", "la-map-toolbar");
  const floorBar = el("div", "la-floors");
  const pinsToggle = el("button", "la-btn la-btn-active", "Pins");
  const roadsToggle = el("button", "la-btn la-btn-active", "Roads");
  const labelsToggle = el("button", "la-btn la-btn-active", "Labels");
  mapToolbar.append(floorBar, pinsToggle, roadsToggle, labelsToggle);
  const inspector = el("div", "la-inspector");
  const mapBody = el("div", "la-section-body");
  mapBody.append(mapControls, canvasWrap, mapToolbar, inspector);
  mapSection.append(mapHead, mapBody);
  const statesSection = el("div", "la-section");
  const statesHead = el("div", "la-section-head");
  const statesTitle = el("div", "la-section-title");
  statesTitle.append(el("span", "la-section-icon", "\uD83D\uDCCA"), el("span", undefined, "Internal States"));
  statesHead.append(statesTitle);
  const statusBar = el("div", "la-status-bar");
  const stateLayout = el("div", "la-state-layout");
  const sidebar = el("div", "la-sidebar");
  const stateContent = el("div", "la-state-content");
  for (const category of CATEGORIES) {
    const sections = STATE_SECTIONS.filter((s) => s.category === category);
    if (!sections.length)
      continue;
    sidebar.append(el("div", "la-sidebar-category", category));
    for (const section of sections) {
      const item = el("div", "la-sidebar-item");
      item.setAttribute("data-section", section.id);
      const icon = el("span", "la-sidebar-icon", section.icon);
      icon.style.color = section.color;
      item.append(icon, el("span", undefined, section.label));
      sidebar.append(item);
    }
  }
  stateLayout.append(sidebar, stateContent);
  const statesBody = el("div", "la-section-body");
  statesBody.append(statusBar, stateLayout);
  statesSection.append(statesHead, statesBody);
  const ledgerSection = el("div", "la-section");
  const ledgerHead = el("div", "la-section-head");
  const ledgerTitle = el("div", "la-section-title");
  ledgerTitle.append(el("span", "la-section-icon", "\uD83D\uDCD2"), el("span", undefined, "Ledger"));
  ledgerHead.append(ledgerTitle);
  const ledgerBody = el("div", "la-section-body la-ledger-body");
  ledgerSection.append(ledgerHead, ledgerBody);
  browser.append(mapSection, statesSection, ledgerSection);
  root.append(header, settingsBox, errorBanner, staleBanner, thinkingBox, browser);
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
      const match = availableLayers(state.scale).find((l) => l.id === pickedId);
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
    state.camera = { x: x + (w - nw) / 2, y: y + (h - nh) / 2, w: nw, h: nh };
    applyCamera();
  }
  function renderMapSvg() {
    svg.replaceChildren();
    const layer = currentLayer();
    const tiles = layer ? getVisibleTiles(layer, state.floor) : [];
    if (!state.activeChatId) {
      hudBadge.textContent = "No Chat";
      emptyOverlay.hidden = false;
      emptyOverlay.replaceChildren(el("strong", undefined, "Open a roleplay chat"), el("span", undefined, "LumiAtlas tracks states per chat."));
      return;
    }
    hudBadge.textContent = layer && layer.tiles.length > 0 ? `${layer.name}${state.scale === "local" ? ` · F${state.floor}` : ""} (${tiles.length})` : state.scale.toUpperCase();
    if (!layer || tiles.length === 0) {
      emptyOverlay.hidden = false;
      emptyOverlay.replaceChildren(el("strong", undefined, `No ${state.scale} tiles yet`), el("span", undefined, state.config.connectionId ? "Click Analyze to generate." : "Pick a model in Settings, then Analyze."));
      return;
    }
    emptyOverlay.hidden = true;
    fitCamera(false);
    const defs = svgEl("defs");
    const gridPat = svgEl("pattern", { id: "la-grid-pat", width: 5, height: 5, patternUnits: "userSpaceOnUse" });
    gridPat.append(svgEl("path", { d: "M 5 0 L 0 0 0 5", fill: "none", stroke: "rgba(255,255,255,0.045)", "stroke-width": 0.25 }));
    const fogPat = svgEl("pattern", { id: "la-fog-pat", width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    fogPat.append(svgEl("rect", { width: 4, height: 4, fill: "#262938" }));
    fogPat.append(svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 4, stroke: "rgba(255,255,255,0.12)", "stroke-width": 1.2 }));
    defs.append(gridPat, fogPat);
    svg.append(defs);
    svg.append(svgEl("rect", { x: -300, y: -300, width: 600, height: 600, fill: "url(#la-grid-pat)" }));
    const tileById = new Map(tiles.map((t) => [t.id, t]));
    for (const tile of tiles) {
      const clip = svgEl("clipPath", { id: `la-clip-${tile.id}` });
      clip.append(svgEl("rect", { x: tile.x + 0.35, y: tile.y + 0.35, width: Math.max(0.5, tile.w - 0.7), height: Math.max(0.5, tile.h - 0.7), rx: state.scale === "local" ? 0.6 : 1 }));
      defs.append(clip);
    }
    const tilesLayer = svgEl("g", { class: "la-layer-tiles" });
    for (const tile of tiles) {
      const isCurrent = layer.currentTileId === tile.id || tile.status === "current";
      const isSelected = state.selectedTileId === tile.id;
      const isFog = tile.status === "locked" || tile.status === "unexplored";
      const isRumored = tile.status === "rumored";
      const g = svgEl("g", { class: `la-tile-group${isCurrent ? " la-tile-current" : ""}${isSelected ? " la-tile-selected" : ""}`, "data-tile-id": tile.id });
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
        g.append(svgEl("rect", { x: tile.x + 0.25, y: tile.y + 0.25, width: Math.max(0, tile.w - 0.5), height: Math.max(0, tile.h * 0.28), rx: state.scale === "local" ? 0.6 : 0.9, fill: "rgba(255,255,255,0.06)", "pointer-events": "none" }));
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
          roadsLayer.append(svgEl("line", { x1, y1, x2, y2, stroke: "#f5d08a", "stroke-width": 1.05, "stroke-linecap": "round" }));
        } else {
          const [x1, y1, x2, y2] = connectorSegment(a, b);
          const strokeColor = road.kind === "sea_route" ? "#60a5fa" : road.kind === "transit" ? "#c084fc" : road.kind === "stairs" ? "#fde047" : "#d4b47c";
          roadsLayer.append(svgEl("line", { x1, y1, x2, y2, stroke: "rgba(15,17,26,0.68)", "stroke-width": road.kind === "road" ? 1.2 : 0.88, "stroke-linecap": "round" }));
          const line = svgEl("line", { x1, y1, x2, y2, stroke: strokeColor, "stroke-width": road.kind === "road" ? 0.6 : 0.42, "stroke-linecap": "round" });
          if (road.kind === "path" || road.kind === "sea_route" || road.kind === "stairs")
            line.setAttribute("stroke-dasharray", "1.3 1.0");
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
        const labelEl = svgEl("text", { class: "la-tile-label", x: cx, y: startY.toFixed(2), "text-anchor": "middle", "font-size": baseFont.toFixed(2) });
        lines.forEach((lineText, idx) => {
          const tspan = svgEl("tspan", { x: cx, dy: idx === 0 ? "0" : lineHeight.toFixed(2) });
          tspan.textContent = lineText;
          labelEl.append(tspan);
        });
        clippedGroup.append(labelEl);
        if (showSize) {
          const sizeY = startY + (lines.length - 1) * lineHeight + sizeFont * 1.45;
          const sizeText = svgEl("text", { class: "la-tile-size", x: cx, y: sizeY.toFixed(2), "text-anchor": "middle", "font-size": sizeFont.toFixed(2) });
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
            pinGroup.append(svgEl("circle", { cx: px.toFixed(2), cy: py.toFixed(2), r: (dotR * 1.75).toFixed(2), fill: "rgba(254,240,138,0.26)", stroke: "#fde047", "stroke-width": 0.24 }));
          }
          pinGroup.append(svgEl("circle", { cx: px.toFixed(2), cy: py.toFixed(2), r: dotR.toFixed(2), fill: color, stroke: "#0f111a", "stroke-width": 0.28 }));
          const slotW = Math.max(3, (tile.w - 1.2) / Math.max(1, colsInRow));
          const maxPinChars = Math.max(4, Math.floor(slotW / (pinFont * 0.6)));
          const pinLabel = svgEl("text", { class: "la-pin-label", x: px.toFixed(2), y: (py + dotR + pinFont * 1.05).toFixed(2), "text-anchor": "middle", "font-size": pinFont.toFixed(2) });
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
      inspector.append(el("div", "la-subtitle", "Select a tile to inspect."));
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
    if (tile.summary)
      inspector.append(el("p", "la-insp-summary", tile.summary));
    if (tile.features.length > 0 && tile.status !== "locked" && tile.status !== "unexplored") {
      inspector.append(el("div", "la-insp-section-label", "Features & Hooks"));
      const ul = el("ul", "la-feature-list");
      for (const feat of tile.features)
        ul.append(el("li", undefined, feat));
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
  function renderStatusBar() {
    statusBar.replaceChildren();
    if (!state.internalState)
      return;
    const world = state.internalState.sections.world ?? "";
    const extract = (tag) => {
      const match = world.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
      return match?.[1]?.trim() ?? "";
    };
    const time = extract("time");
    const date = extract("date");
    const loc = extract("loc");
    const weather = extract("weather");
    if (time)
      statusBar.append(el("span", "la-status-badge", `\uD83D\uDD50 ${time}`));
    if (date)
      statusBar.append(el("span", "la-status-badge", `\uD83D\uDCC5 ${date}`));
    if (loc)
      statusBar.append(el("span", "la-status-badge", `\uD83D\uDCCD ${loc}`));
    if (weather)
      statusBar.append(el("span", "la-status-badge", weather));
  }
  function renderStateContent() {
    stateContent.replaceChildren();
    if (!state.activeChatId) {
      stateContent.append(el("p", "la-subtitle", "Open a chat to view states."));
      return;
    }
    if (state.internalLoading) {
      stateContent.append(el("p", "la-subtitle", "Loading states…"));
      return;
    }
    if (state.internalInvalid || state.error && !state.internalState) {
      stateContent.append(el("p", "la-subtitle", "Unable to load states."));
      return;
    }
    if (!state.internalState) {
      stateContent.append(el("p", "la-subtitle", "No states available for this chat."));
      return;
    }
    const section = STATE_SECTIONS.find((s) => s.id === state.stateSection);
    if (!section)
      return;
    const raw = state.internalState.sections[section.id] ?? "";
    if (!raw.trim()) {
      stateContent.append(el("p", "la-subtitle", `No ${section.label.toLowerCase()} data available.`));
      return;
    }
    const records = parseStateRecords(raw);
    for (const record of records) {
      const cardId = `${section.id}:${record.name}`;
      const isExpanded = state.expandedCards.has(cardId);
      const card = el("div", "la-card");
      if (section.collapsible) {
        const head = el("div", `la-card-head${isExpanded ? " la-expanded" : ""}`);
        const chevron = el("span", "la-card-chevron", isExpanded ? "▾" : "▸");
        const dot = el("span", "la-card-dot");
        dot.style.background = section.color;
        const name = el("span", "la-card-name", record.name);
        head.append(chevron, dot, name);
        if (record.badge)
          head.append(el("span", "la-card-badge", record.badge));
        card.append(head);
        if (isExpanded) {
          const body = el("div", "la-card-body");
          if (record.location) {
            body.append(el("div", "la-card-location", `→ ${record.location}`));
          }
          if (record.fields.length) {
            const fields = el("div", "la-card-fields");
            for (const field of record.fields) {
              const fieldEl = el("div", "la-card-field");
              fieldEl.append(el("span", "la-card-field-label", field.label));
              fieldEl.append(el("span", "la-card-field-value", field.value));
              fields.append(fieldEl);
            }
            body.append(fields);
          }
          if (record.details.length) {
            for (const detail of record.details) {
              const detailEl = el("div", "la-card-detail");
              detailEl.append(el("div", "la-card-detail-title", detail.title));
              detailEl.append(el("div", "la-card-detail-text", detail.text));
              body.append(detailEl);
            }
          }
          if (record.rawText && !record.fields.length && !record.details.length) {
            body.append(el("div", "la-card-detail-text", record.rawText));
          }
          card.append(body);
        }
        head.addEventListener("click", () => {
          if (state.expandedCards.has(cardId))
            state.expandedCards.delete(cardId);
          else
            state.expandedCards.add(cardId);
          renderStateContent();
        });
      } else {
        const head = el("div", "la-card-head la-flat");
        const dot = el("span", "la-card-dot");
        dot.style.background = section.color;
        const name = el("span", "la-card-name", record.name);
        head.append(dot, name);
        if (record.badge)
          head.append(el("span", "la-card-badge", record.badge));
        card.append(head);
        const body = el("div", "la-card-body");
        if (record.location) {
          body.append(el("div", "la-card-location", `→ ${record.location}`));
        }
        if (record.fields.length) {
          const fields = el("div", "la-card-fields");
          for (const field of record.fields) {
            const fieldEl = el("div", "la-card-field");
            fieldEl.append(el("span", "la-card-field-label", field.label));
            fieldEl.append(el("span", "la-card-field-value", field.value));
            fields.append(fieldEl);
          }
          body.append(fields);
        }
        if (record.details.length) {
          for (const detail of record.details) {
            const detailEl = el("div", "la-card-detail");
            detailEl.append(el("div", "la-card-detail-title", detail.title));
            detailEl.append(el("div", "la-card-detail-text", detail.text));
            body.append(detailEl);
          }
        }
        if (record.rawText && !record.fields.length && !record.details.length) {
          body.append(el("div", "la-card-detail-text", record.rawText));
        }
        card.append(body);
      }
      stateContent.append(card);
    }
  }
  function renderSidebar() {
    const items = sidebar.querySelectorAll(".la-sidebar-item");
    items.forEach((item) => {
      const sectionId = item.getAttribute("data-section");
      item.classList.toggle("la-active", sectionId === state.stateSection);
    });
  }
  function renderLedger() {
    ledgerBody.replaceChildren();
    if (!state.activeChatId) {
      ledgerBody.append(el("div", "la-ledger-empty", "Open a chat to view the ledger."));
      return;
    }
    if (state.internalLoading) {
      ledgerBody.append(el("div", "la-ledger-empty", "Loading…"));
      return;
    }
    const content = state.internalState ? revealedLedger(state.internalState.ledger) : null;
    if (content) {
      ledgerBody.append(el("div", "la-ledger-content", content));
    } else {
      ledgerBody.append(el("div", "la-ledger-empty", "No revealed Ledger available."));
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
        if (reasoningText)
          thinkingBody.textContent = reasoningText;
        else if (state.stream?.outputTail)
          thinkingBody.textContent = `Generating map JSON (${outChars} chars)…
${state.stream.outputTail}`;
        else if (state.busy)
          thinkingBody.textContent = state.config.reasoningMode === "off" ? "Streaming JSON directly…" : "Waiting for reasoning tokens…";
        else
          thinkingBody.textContent = "";
        thinkingBody.scrollTop = thinkingBody.scrollHeight;
      }
    }
    scaleSelect.value = state.scale;
    const layers = availableLayers(state.scale);
    zoneSelect.disabled = layers.length === 0;
    zoneSelect.replaceChildren();
    if (!layers.length) {
      const empty = el("option", undefined, "No maps available");
      empty.value = "";
      zoneSelect.append(empty);
    } else {
      const activeId = state.atlas?.maps?.[state.scale]?.id ?? null;
      for (const l of layers) {
        const isCurrent = l.id === activeId;
        const opt = el("option", undefined, `${l.name} (${l.tiles.length} ${l.tiles.length === 1 ? "tile" : "tiles"})${isCurrent ? " · Current" : ""}`);
        opt.value = l.id;
        zoneSelect.append(opt);
      }
      zoneSelect.value = currentLayer()?.id ?? layers[0]?.id ?? "";
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
    renderStatusBar();
    renderSidebar();
    renderStateContent();
    renderLedger();
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
    send({ type: "set_chat_config", chatId: state.activeChatId, enabled: state.config.enabled, autoUpdate: state.config.autoUpdate });
    renderAll();
  });
  on(autoInput, "change", () => {
    if (!state.activeChatId)
      return;
    state.config.autoUpdate = autoInput.checked;
    send({ type: "set_chat_config", chatId: state.activeChatId, enabled: state.config.enabled, autoUpdate: state.config.autoUpdate });
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
  sidebar.addEventListener("click", (ev) => {
    const item = ev.target.closest(".la-sidebar-item");
    if (!item)
      return;
    const sectionId = item.getAttribute("data-section");
    if (!sectionId)
      return;
    state.stateSection = sectionId;
    renderSidebar();
    renderStateContent();
  });
  on(zoneSelect, "change", () => {
    const picked = zoneSelect.value || null;
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
  let dragStartX = 0, dragStartY = 0, camStartX = 0, camStartY = 0;
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
      if (!layer?.tiles.some((tile) => tile.id === state.selectedTileId))
        state.selectedTileId = layer?.currentTileId ?? null;
      fitCamera(false);
      renderAll();
      return;
    }
    if (msg.type === "stream") {
      if (!state.activeChatId || msg.chatId !== state.activeChatId)
        return;
      state.busy = true;
      state.stream = { phase: msg.phase, reasoning: msg.reasoning, outputChars: msg.outputChars, outputTail: msg.outputTail };
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
        if (!layer?.tiles.some((tile) => tile.id === state.selectedTileId))
          state.selectedTileId = layer?.currentTileId ?? null;
      }
      if (msg.archives && msg.state === undefined)
        reconcileSelectedLayers();
      state.busy = msg.status === "updating";
      state.statusMessage = msg.message;
      state.error = msg.status === "error" ? msg.message : null;
      if (msg.status === "ready") {
        tab.setBadge(null);
        if (state.stream && !state.stream.reasoning)
          state.stream = null;
        else if (state.stream)
          state.thinkingOpen = false;
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
