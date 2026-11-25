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

// src/state-renderer.ts
var LEDGER_ELEMENT = /^(?:(?:[\w.-]+:)?(?:details|ledger|activation)|ledger:[\w.-]+)$/i;
var BRAILLE_SPACE = /\u2800+/g;
function normText(raw) {
  if (!raw)
    return "";
  return raw.replace(BRAILLE_SPACE, " ").replace(/[ \t]+/g, " ").trim();
}
function isEmptyVal(val) {
  const t = normText(val);
  return !t || t === "∅" || t === "Ø" || t === "—" || t === "-";
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className)
    node.className = className;
  if (text !== undefined)
    node.textContent = text;
  return node;
}
function parseSectionXml(raw) {
  const input = raw.trim();
  if (!input || /<!\s*(?:DOCTYPE|ENTITY)/i.test(input))
    return { root: null, blocked: false };
  try {
    const parser = new window.DOMParser;
    const parsed = parser.parseFromString(`<root xmlns:state="urn:lumi-atlas:state">${input}</root>`, "application/xml");
    if (parsed.querySelector("parsererror"))
      return { root: null, blocked: false };
    const root = parsed.documentElement;
    const stateEl = Array.from(root.children).find((c) => c.tagName.startsWith("state:"));
    if (stateEl && LEDGER_ELEMENT.test(stateEl.tagName))
      return { root: null, blocked: true };
    const target = stateEl ?? root;
    const clone = target.cloneNode(true);
    for (const node of Array.from(clone.querySelectorAll("*"))) {
      if (LEDGER_ELEMENT.test(node.tagName))
        node.remove();
    }
    return { root: clone, blocked: false };
  } catch {
    return { root: null, blocked: false };
  }
}
function childText(parent, tag) {
  for (const child of Array.from(parent.children)) {
    if (child.tagName.toLowerCase() === tag.toLowerCase()) {
      return normText(child.textContent);
    }
  }
  return "";
}
function childrenByTag(parent, tag) {
  const lower = tag.toLowerCase();
  return Array.from(parent.children).filter((c) => c.tagName.toLowerCase() === lower);
}
function makeCollapsibleCard(opts, buildBody) {
  const isExpanded = opts.expandedCards.has(opts.cardId);
  const card = el("div", `la-card${isExpanded ? " la-card-open" : ""}`);
  const head = el("div", `la-card-head${isExpanded ? " la-expanded" : ""}`);
  head.setAttribute("role", "button");
  head.setAttribute("tabindex", "0");
  head.setAttribute("aria-expanded", String(isExpanded));
  const chevron = el("span", "la-card-chevron", isExpanded ? "▾" : "▸");
  const iconEl = el("span", "la-card-icon", opts.icon);
  if (opts.accentColor)
    iconEl.style.color = opts.accentColor;
  const nameWrap = el("span", "la-card-name");
  nameWrap.append(document.createTextNode(opts.title));
  if (opts.titleCode) {
    nameWrap.append(document.createTextNode(" "), el("code", "la-loc-id", opts.titleCode));
  }
  head.append(chevron, iconEl, nameWrap);
  if (opts.badge)
    head.append(el("span", "la-card-badge", opts.badge));
  card.append(head);
  if (isExpanded) {
    const body = el("div", "la-card-body");
    buildBody(body);
    card.append(body);
  }
  const toggle = () => {
    if (opts.expandedCards.has(opts.cardId))
      opts.expandedCards.delete(opts.cardId);
    else
      opts.expandedCards.add(opts.cardId);
    opts.onToggle();
  };
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      toggle();
    }
  });
  return card;
}
function renderEmpty(container, label) {
  container.append(el("p", "la-subtitle", `No ${label.toLowerCase()} data available.`));
}
function renderWorld(root, container) {
  const ct = childText(root, "ct");
  const loc = childText(root, "loc");
  const time = childText(root, "time");
  const date = childText(root, "date");
  const weather = childText(root, "weather");
  const room = childText(root, "room");
  const userPos = childText(root, "user_pos");
  const entries = childText(root, "entries");
  const obstacles = childText(root, "obstacles");
  const audio = childText(root, "audio");
  const pacing = childText(root, "pacing");
  if (!ct && !loc && !time && !room && !userPos && !entries && !obstacles && !audio && !pacing) {
    return false;
  }
  const hud = el("div", "la-world-hud");
  if (ct || loc || time || date || weather || pacing) {
    const bar = el("div", "la-world-bar");
    if (ct)
      bar.append(el("span", "la-world-pill la-world-ct", `CT ${ct}`));
    if (time)
      bar.append(el("span", "la-world-pill", `\uD83D\uDD50 ${time}`));
    if (date)
      bar.append(el("span", "la-world-pill", `\uD83D\uDCC5 ${date}`));
    if (loc)
      bar.append(el("span", "la-world-pill", `\uD83D\uDCCD ${loc}`));
    if (weather)
      bar.append(el("span", "la-world-pill", `\uD83C\uDF25 ${weather}`));
    if (pacing)
      bar.append(el("span", "la-world-pill la-world-pacing", `⏱ ${pacing}`));
    hud.append(bar);
  }
  const addPanel = (icon, label, val, highlight = false) => {
    if (!val)
      return;
    const box = el("div", `la-flat-panel${highlight ? " la-flat-highlight" : ""}`);
    box.append(el("div", "la-flat-badge", `${icon} ${label}`));
    box.append(el("div", "la-flat-text", val));
    hud.append(box);
  };
  addPanel("\uD83D\uDC64", "POSITION", userPos, true);
  addPanel("\uD83C\uDFA8", "ROOM", room);
  addPanel("\uD83D\uDEAA", "ENTRIES", entries);
  addPanel("\uD83E\uDDF1", "OBSTACLES", obstacles);
  addPanel("\uD83D\uDD0A", "AUDIO", audio);
  const known = new Set(["ct", "loc", "time", "date", "weather", "room", "user_pos", "entries", "obstacles", "audio", "pacing"]);
  for (const child of Array.from(root.children)) {
    if (known.has(child.tagName.toLowerCase()))
      continue;
    const val = normText(child.textContent);
    if (val)
      addPanel("•", child.tagName.replace(/_/g, " ").toUpperCase(), val);
  }
  container.append(hud);
  return true;
}
function renderOnScreen(root, container, expandedCards, onToggle) {
  const entries = childrenByTag(root, "ent_on");
  if (!entries.length) {
    const t = normText(root.textContent);
    if (isEmptyVal(t)) {
      container.append(el("p", "la-subtitle", "Nobody else on-screen right now."));
      return true;
    }
    return false;
  }
  for (const entry of entries) {
    const name = childText(entry, "name") || "Character";
    const sal = childText(entry, "salience").replace(/^sal:\s*/i, "");
    const parrott = childText(entry, "parrott");
    const residual = childText(entry, "residualMood");
    const tfdy = childText(entry, "tfdy");
    const agenda = childText(entry, "agenda");
    const why = childText(entry, "why");
    const end = childText(entry, "end");
    const move = childText(entry, "move");
    const card = makeCollapsibleCard({
      cardId: `onscreen:${name}`,
      icon: "\uD83D\uDC64",
      title: name,
      badge: sal ? `SAL ${sal}` : undefined,
      accentColor: "#c084fc",
      expandedCards,
      onToggle
    }, (body) => {
      if (parrott || tfdy) {
        const bar = el("div", "la-meta-bar");
        if (parrott)
          bar.append(el("span", "la-meta-chip", parrott));
        if (tfdy)
          bar.append(el("span", "la-meta-chip la-meta-mono", tfdy));
        body.append(bar);
      }
      if (residual)
        body.append(el("div", "la-card-subtext", residual));
      for (const [k, v] of [
        ["AGENDA", agenda],
        ["WHY", why],
        ["END", end],
        ["MOVE", move]
      ]) {
        if (!v)
          continue;
        const row = el("div", "la-card-detail");
        row.append(el("div", "la-card-detail-title", k), el("div", "la-card-detail-text", v));
        body.append(row);
      }
    });
    container.append(card);
  }
  return true;
}
function renderOffScreen(root, container, expandedCards, onToggle) {
  const entries = childrenByTag(root, "ent_off");
  if (!entries.length)
    return false;
  for (const entry of entries) {
    const name = childText(entry, "name") || "Character";
    const loc = childText(entry, "loc");
    const sal = childText(entry, "salience").replace(/^sal:\s*/i, "");
    const mood = childText(entry, "mood").replace(/^Parrot(?:Mood|Emotion):\s*/i, "");
    const tfdy = childText(entry, "tfdy");
    const agenda = childText(entry, "agenda");
    const why = childText(entry, "why");
    const goal = childText(entry, "goal");
    const end = childText(entry, "end");
    const card = makeCollapsibleCard({
      cardId: `offscreen_agendas:${name}`,
      icon: "\uD83C\uDF19",
      title: name,
      badge: sal ? `SIG ${sal}` : undefined,
      accentColor: "#c4973c",
      expandedCards,
      onToggle
    }, (body) => {
      if (loc)
        body.append(el("div", "la-card-location", `\uD83D\uDCCD ${loc}`));
      if (mood || tfdy) {
        const bar = el("div", "la-meta-bar");
        if (mood)
          bar.append(el("span", "la-meta-chip", mood));
        if (tfdy)
          bar.append(el("span", "la-meta-chip la-meta-mono", tfdy));
        body.append(bar);
      }
      for (const [k, v] of [
        ["AGENDA", agenda],
        ["WHY", why],
        ["GOAL", goal],
        ["END", end]
      ]) {
        if (!v)
          continue;
        const row = el("div", "la-card-detail");
        row.append(el("div", "la-card-detail-title", k), el("div", "la-card-detail-text", v));
        body.append(row);
      }
    });
    container.append(card);
  }
  return true;
}
function renderLocations(root, container, expandedCards, onToggle) {
  const rendered = childrenByTag(root, "loc_rend");
  const loaded = childrenByTag(root, "loc_load");
  const all = [
    ...rendered.map((node) => ({ node, kind: "Rendered", icon: "\uD83D\uDCCD" })),
    ...loaded.map((node) => ({ node, kind: "Loaded", icon: "◌" }))
  ];
  if (!all.length)
    return false;
  for (const { node, kind, icon } of all) {
    const id = childText(node, "id");
    const name = childText(node, "name") || id || "Location";
    const mapId = childText(node, "map_id");
    const dim = childText(node, "dim");
    const bbox = childText(node, "bbox");
    const anchor = childText(node, "anchor");
    const features = childText(node, "features");
    const adj = childText(node, "adj");
    const grid = childText(node, "grid");
    const occupants = childText(node, "occupants");
    const exits = childText(node, "exits");
    const updated = childText(node, "updated");
    const card = makeCollapsibleCard({
      cardId: `locations:${id || name}`,
      icon,
      title: name,
      titleCode: id || undefined,
      badge: kind,
      accentColor: kind === "Rendered" ? "#e86a6a" : "#8a8078",
      expandedCards,
      onToggle
    }, (body) => {
      const metaPairs = [
        ["Map", mapId],
        ["Dimensions", dim],
        ["Grid", grid],
        ["BBox", bbox],
        ["Anchor", anchor]
      ].filter(([, v]) => Boolean(v));
      if (metaPairs.length) {
        const gridEl = el("div", "la-kv-grid");
        for (const [k, v] of metaPairs) {
          const cell = el("div", "la-kv-cell");
          cell.append(el("div", "la-kv-k", k), el("div", "la-kv-v", v));
          gridEl.append(cell);
        }
        body.append(gridEl);
      }
      for (const [k, v] of [
        ["FEATURES", features],
        ["OCCUPANTS", occupants],
        ["ADJACENT", adj],
        ["DOORWAYS", exits]
      ]) {
        if (!v || isEmptyVal(v))
          continue;
        const row = el("div", "la-card-detail");
        row.append(el("div", "la-card-detail-title", k), el("div", "la-card-detail-text", v));
        body.append(row);
      }
      if (updated)
        body.append(el("div", "la-card-footer", `Updated: ${updated}`));
    });
    container.append(card);
  }
  return true;
}
function renderEntityMemory(root, container, expandedCards, onToggle) {
  const entries = childrenByTag(root, "ent_mem");
  if (!entries.length)
    return false;
  for (const entry of entries) {
    const name = childText(entry, "name") || "Entity";
    const mems = childrenByTag(entry, "mem");
    const card = makeCollapsibleCard({
      cardId: `entityMem:${name}`,
      icon: "\uD83E\uDDE0",
      title: name,
      badge: mems.length ? `${mems.length} mem` : "Knowledge",
      accentColor: "#e86a8a",
      expandedCards,
      onToggle
    }, (body) => {
      for (const memEl of mems) {
        const raw = normText(memEl.textContent);
        if (!raw)
          continue;
        const match = raw.match(/^([\s\S]*?)\s*\|\s*T:\s*([^|]+?)\s*\|\s*V:\s*([^|]+?)\s*\|\s*C:\s*(.+)$/);
        const item = el("div", "la-mem-entry");
        if (match) {
          item.append(el("div", "la-mem-fact", match[1].trim()));
          const meta = el("div", "la-meta-bar");
          meta.append(el("span", "la-meta-chip", `\uD83D\uDD50 ${match[2].trim()}`), el("span", "la-meta-chip", `\uD83D\uDC41 ${match[3].trim()}`), el("span", "la-meta-chip la-mem-cert", match[4].trim()));
          item.append(meta);
        } else {
          item.append(el("div", "la-mem-fact", raw));
        }
        body.append(item);
      }
    });
    container.append(card);
  }
  return true;
}
function renderEntityProfile(root, container, expandedCards, onToggle) {
  const entries = childrenByTag(root, "ent_col");
  if (!entries.length)
    return false;
  for (const entry of entries) {
    const name = childText(entry, "name") || "Entity";
    const fontColor = childText(entry, "fontColor");
    const hexMatch = fontColor.match(/#[0-9a-fA-F]{6}/);
    const swatchHex = hexMatch ? hexMatch[0] : undefined;
    const look = childText(entry, "look");
    const voice = childText(entry, "voice");
    const persona = childText(entry, "persona");
    const priv = childText(entry, "private");
    const card = makeCollapsibleCard({
      cardId: `entity_state:${name}`,
      icon: "\uD83E\uDEAA",
      title: name,
      badge: "Profile",
      accentColor: swatchHex ?? "#6a8ae8",
      expandedCards,
      onToggle
    }, (body) => {
      if (fontColor) {
        const row = el("div", "la-color-row");
        const dot = el("span", "la-color-swatch");
        if (swatchHex)
          dot.style.background = swatchHex;
        row.append(dot, el("span", "la-kv-k", "Font color"), el("code", "la-loc-id", fontColor));
        body.append(row);
      }
      for (const [k, v] of [
        ["APPEARANCE", look],
        ["VOICE", voice],
        ["PERSONALITY", persona],
        ["PRIVATE KNOWLEDGE", priv]
      ]) {
        if (!v)
          continue;
        const row = el("div", "la-card-detail");
        row.append(el("div", "la-card-detail-title", k), el("div", "la-card-detail-text", v));
        body.append(row);
      }
    });
    container.append(card);
  }
  return true;
}
var THOUGHT_QUESTIONS = [
  ["tQ1", "Q1", "What's your goal right now?"],
  ["tQ2", "Q2", "How do you feel about what just happened?"],
  ["tQ3", "Q3", "Where is your mind right now?"],
  ["tQ4", "Q4", "Why do you care?"],
  ["tQ5", "Q5", "If you could speak your mind right now, what would you actually say?"]
];
function renderThoughts(root, container, expandedCards, onToggle) {
  const entries = childrenByTag(root, "ent_think");
  if (!entries.length)
    return false;
  for (const entry of entries) {
    const name = childText(entry, "name") || "Character";
    const card = makeCollapsibleCard({
      cardId: `thoughts:${name}`,
      icon: "\uD83D\uDCAD",
      title: name,
      badge: "BTS INTERVIEW",
      accentColor: "#a78bfa",
      expandedCards,
      onToggle
    }, (body) => {
      let idx = 0;
      for (const [tag, qLabel, question] of THOUGHT_QUESTIONS) {
        const answer = childText(entry, tag);
        if (!answer)
          continue;
        idx++;
        const qa = el("div", `la-qa-card ${idx % 2 === 0 ? "la-qa-even" : "la-qa-odd"}`);
        const qHead = el("div", "la-qa-head");
        qHead.append(el("span", "la-qa-badge", qLabel), el("span", "la-qa-question", question));
        qa.append(qHead, el("div", "la-qa-answer", answer));
        body.append(qa);
      }
    });
    container.append(card);
  }
  return true;
}
function normalizeFilterCode(code) {
  const c = code.trim().toLowerCase();
  if (c === "h" || c === "hard")
    return "HARD";
  if (c === "c" || c === "crack" || c === "cracked")
    return "CRACK";
  if (c === "r" || c === "limit" || c === "restricted")
    return "LIMIT";
  if (c === "o" || c === "open")
    return "OPEN";
  return "";
}
function renderDams(root, container, expandedCards, onToggle) {
  const entries = childrenByTag(root, "ent_dam");
  if (!entries.length)
    return false;
  for (const entry of entries) {
    const pair = childText(entry, "pair") || childText(entry, "name") || "Relationship";
    const sluiceRaw = childText(entry, "sluice");
    const filtersRaw = childText(entry, "filters");
    const miscRaw = childText(entry, "misc");
    const intentRaw = childText(entry, "intent").replace(/^intent:\s*/i, "");
    const eSluice = sluiceRaw.match(/E:\s*([a-z-]+)/i)?.[1]?.toLowerCase() ?? "";
    const lSluice = sluiceRaw.match(/L:\s*([a-z-]+)/i)?.[1]?.toLowerCase() ?? "";
    const clashVal = miscRaw.match(/clash:\s*([^|\s]+)/i)?.[1]?.toLowerCase() ?? "";
    const tensionVal = miscRaw.match(/T:\s*([^|\s]+)/i)?.[1]?.toLowerCase() ?? "";
    const isClash = clashVal === "yes" || clashVal !== "" && clashVal !== "no" && clashVal !== "—" && clashVal !== "-" && clashVal !== "∅";
    const isTension = tensionVal === "yes";
    const parseFilter = (key) => {
      const m = filtersRaw.match(new RegExp(`${key}:\\s*\\[?(hard|cracked|restricted|open|[hcro])\\]?\\s*((?:\\([^)]*\\)\\s*)*)`, "i"));
      return {
        state: m ? normalizeFilterCode(m[1]) : "",
        note: m?.[2]?.trim() ?? ""
      };
    };
    const filterItems = [
      { name: "SOCIAL", ...parseFilter("Soc") },
      { name: "VALUES", ...parseFilter("Val") },
      { name: "COMPETENCE", ...parseFilter("Comp") },
      { name: "RELATIONSHIP", ...parseFilter("Rel") }
    ];
    const card = makeCollapsibleCard({
      cardId: `dam:${pair}`,
      icon: "\uD83E\uDEB5",
      title: pair,
      badge: "DIRECTIONAL",
      accentColor: "#c4973c",
      expandedCards,
      onToggle
    }, (body) => {
      const topRow = el("div", "la-dam-top");
      const sluiceBox = el("div", "la-dam-block");
      sluiceBox.append(el("div", "la-dam-block-title", "SLUICES"));
      for (const [label, st] of [["E · EMOTION", eSluice], ["L · LANGUAGE", lSluice]]) {
        const row = el("div", "la-dam-ctrl");
        row.append(el("div", "la-dam-ctrl-name", label));
        const opts = el("div", "la-dam-opts");
        const isOpen = st === "open" || st === "o";
        const isSealed = st === "sealed" || st === "s";
        opts.append(el("span", `la-dam-opt${isSealed ? " la-opt-amber" : ""}`, "SEALED"), el("span", `la-dam-opt${isOpen ? " la-opt-green" : ""}`, "OPEN"));
        row.append(opts);
        sluiceBox.append(row);
      }
      topRow.append(sluiceBox);
      const flagBox = el("div", "la-dam-block");
      flagBox.append(el("div", "la-dam-block-title", "FLAGS"));
      for (const [label, active] of [["CLASH", isClash], ["TENSION", isTension]]) {
        const row = el("div", "la-dam-ctrl");
        row.append(el("div", "la-dam-ctrl-name", label));
        const opts = el("div", "la-dam-opts");
        opts.append(el("span", `la-dam-opt${!active ? " la-opt-neutral" : ""}`, "NO"), el("span", `la-dam-opt${active ? " la-opt-red" : ""}`, "YES"));
        row.append(opts);
        flagBox.append(row);
      }
      topRow.append(flagBox);
      body.append(topRow);
      const filterBox = el("div", "la-dam-block");
      filterBox.append(el("div", "la-dam-block-title", "FILTERS · HARD / CRACKED / RESTRICTED / OPEN"));
      const grid = el("div", "la-dam-filter-grid");
      for (const f of filterItems) {
        const cell = el("div", "la-dam-filter-cell");
        const head = el("div", "la-dam-filter-head");
        head.append(el("span", "la-dam-ctrl-name", f.name));
        if (f.note)
          head.append(el("span", "la-dam-counter", f.note));
        cell.append(head);
        const opts = el("div", "la-dam-opts la-dam-opts-4");
        for (const opt of ["HARD", "CRACK", "LIMIT", "OPEN"]) {
          const activeClass = f.state !== opt ? "" : opt === "HARD" ? " la-opt-red" : opt === "CRACK" ? " la-opt-amber" : opt === "LIMIT" ? " la-opt-blue" : " la-opt-green";
          opts.append(el("span", `la-dam-opt${activeClass}`, opt));
        }
        cell.append(opts);
        grid.append(cell);
      }
      filterBox.append(grid);
      body.append(filterBox);
      if (intentRaw) {
        const intentEl = el("div", "la-dam-intent");
        intentEl.append(el("span", "la-dam-intent-label", "\uD83C\uDFAF INTENT "), el("span", "la-dam-intent-text", intentRaw));
        body.append(intentEl);
      }
    });
    container.append(card);
  }
  return true;
}
var PAIR_AXES = [
  { negEmoji: "\uD83D\uDE20", negLabel: "Hatred", negColor: "#e87a6a", posEmoji: "\uD83C\uDF36️", posLabel: "Desire", posColor: "#f08868" },
  { negEmoji: "\uD83E\uDD4A", negLabel: "Conflict", negColor: "#f08a9a", posEmoji: "\uD83C\uDFB2", posLabel: "Play", posColor: "#e8c44e" },
  { negEmoji: "❄️", negLabel: "Hostility", negColor: "#7ec8f0", posEmoji: "\uD83E\uDD1D", posLabel: "Friendship", posColor: "#8aa8d8" },
  { negEmoji: "\uD83E\uDEA8", negLabel: "Stagnation", negColor: "#a89cf0", posEmoji: "\uD83D\uDEE0️", posLabel: "Commitment", posColor: "#e8a84e" },
  { negEmoji: "\uD83C\uDF2B️", negLabel: "Indifference", negColor: "#98a0a8", posEmoji: "\uD83C\uDFE0", posLabel: "Warmth", posColor: "#e8b878" },
  { negEmoji: "\uD83D\uDC0D", negLabel: "Envy", negColor: "#88c888", posEmoji: "\uD83D\uDD4A️", posLabel: "Devotion", posColor: "#c8d8f0" }
];
var PAIR_EMOJI_ALIAS = {
  "\uD83E\uDD2C": "\uD83D\uDE20",
  "\uD83D\uDE21": "\uD83D\uDE20",
  "\uD83D\uDC9B": "\uD83E\uDD1D"
};
function normPairEmoji(raw) {
  const clean = raw.replace(/\uFE0F/g, "");
  return PAIR_EMOJI_ALIAS[clean] ?? clean;
}
function parseMatrixTokens(raw) {
  const map = new Map;
  const re = /([^\s\[\]|]+)\s*\[\s*([+-]?\d+)\s*,\s*([^\]]+?)\s*\]/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    map.set(normPairEmoji(m[1]), { val: parseInt(m[2], 10) || 0, acc: m[3].trim() });
  }
  return map;
}
function parseFallbackMatrixStats(raw) {
  const stats = [];
  for (const part of raw.split(/[|\n,]+/)) {
    const m = part.trim().match(/^([^\s\d+-]+)\s*[:=]?\s*([+-]?\d+)$/);
    if (m)
      stats.push({ icon: m[1], val: parseInt(m[2], 10) || 0 });
  }
  return stats;
}
function shortBadge(raw, maxLen = 28) {
  const clean = normText(raw);
  if (!clean)
    return "";
  const head = clean.split(/\s+[—–-]\s+|\s*[:;|]\s*/)[0].trim() || clean;
  return head.length > maxLen ? `${head.slice(0, maxLen - 1).trimEnd()}…` : head;
}
function renderPairs(root, container, expandedCards, onToggle) {
  const entries = childrenByTag(root, "pair");
  if (!entries.length)
    return false;
  for (const entry of entries) {
    const names = childText(entry, "names") || childText(entry, "name") || "Pair";
    const mode = childText(entry, "mode").replace(/^mode:\s*/i, "");
    const damRaw = childText(entry, "dam");
    const matrixRaw = childText(entry, "matrix");
    const wallRaw = childText(entry, "wall").replace(/^wall:\s*/i, "");
    const eVal = damRaw.match(/E:\s*([^\s]+)/i)?.[1];
    const lVal = damRaw.match(/L:\s*([^\s]+)/i)?.[1];
    const gateVal = damRaw.match(/Gate:\s*([^\s]+)/i)?.[1];
    const tokens = parseMatrixTokens(matrixRaw);
    const card = makeCollapsibleCard({
      cardId: `pair:${names}`,
      icon: "\uD83D\uDC9A",
      title: names,
      badge: shortBadge(mode || "PAIR"),
      accentColor: "#4ade80",
      expandedCards,
      onToggle
    }, (body) => {
      if (eVal || lVal || gateVal) {
        const chips = el("div", "la-meta-bar");
        if (eVal)
          chips.append(el("span", "la-meta-chip", `E · ${eVal}`));
        if (lVal)
          chips.append(el("span", "la-meta-chip", `L · ${lVal}`));
        if (gateVal)
          chips.append(el("span", "la-meta-chip", `Gate · ${gateVal}`));
        body.append(chips);
      }
      const hasVexaAxis = tokens.size > 0 && PAIR_AXES.some((a) => tokens.has(normPairEmoji(a.negEmoji)) || tokens.has(normPairEmoji(a.posEmoji)));
      if (hasVexaAxis) {
        const stack = el("div", "la-axis-stack");
        for (const axis of PAIR_AXES) {
          const neg = tokens.get(normPairEmoji(axis.negEmoji)) ?? { val: 0, acc: "0" };
          const pos = tokens.get(normPairEmoji(axis.posEmoji)) ?? { val: 0, acc: "0" };
          const row = el("div", "la-axis-row");
          const labels = el("div", "la-axis-labels");
          const leftLbl = el("span", "la-axis-side la-axis-neg");
          leftLbl.style.color = axis.negColor;
          leftLbl.append(document.createTextNode(`${axis.negEmoji} ${axis.negLabel} `), el("strong", undefined, String(neg.val)), el("small", "la-axis-acc", ` acc ${neg.acc}`));
          const rightLbl = el("span", "la-axis-side la-axis-pos");
          rightLbl.style.color = axis.posColor;
          rightLbl.append(document.createTextNode(`${axis.posEmoji} ${axis.posLabel} `), el("strong", undefined, String(pos.val)), el("small", "la-axis-acc", ` acc ${pos.acc}`));
          labels.append(leftLbl, rightLbl);
          const track = el("div", "la-axis-track");
          const negHalf = el("div", "la-axis-half la-axis-half-neg");
          const negFill = el("div", "la-axis-fill");
          negFill.style.width = `${Math.min(100, Math.max(0, neg.val) * 6.5)}%`;
          negFill.style.background = axis.negColor;
          negHalf.append(negFill);
          const posHalf = el("div", "la-axis-half la-axis-half-pos");
          const posFill = el("div", "la-axis-fill");
          posFill.style.width = `${Math.min(100, Math.max(0, pos.val) * 6.5)}%`;
          posFill.style.background = axis.posColor;
          posHalf.append(posFill);
          track.append(negHalf, el("div", "la-axis-center"), posHalf);
          row.append(labels, track);
          stack.append(row);
        }
        body.append(stack);
      } else if (matrixRaw) {
        const fallbackStats = parseFallbackMatrixStats(matrixRaw);
        if (fallbackStats.length > 0) {
          const maxStat = Math.max(10, ...fallbackStats.map((s) => Math.abs(s.val)));
          const grid = el("div", "la-stat-grid");
          for (const stat of fallbackStats) {
            const cell = el("div", "la-stat-cell");
            const head = el("div", "la-stat-head");
            head.append(el("span", undefined, stat.icon), el("strong", undefined, String(stat.val)));
            const track = el("div", "la-stat-track");
            const fill = el("div", "la-stat-fill");
            fill.style.width = `${Math.min(100, Math.max(4, Math.abs(stat.val) / maxStat * 100))}%`;
            track.append(fill);
            cell.append(head, track);
            grid.append(cell);
          }
          body.append(grid);
        } else {
          body.append(el("div", "la-card-detail-text", matrixRaw));
        }
      }
      if (wallRaw && !isEmptyVal(wallRaw)) {
        body.append(el("div", "la-card-footer", `Wall: ${wallRaw}`));
      }
    });
    container.append(card);
  }
  return true;
}
function parseReputationScore(scoreRaw, standingRaw) {
  const numMatch = (scoreRaw || standingRaw).match(/([+-]?\d{1,4})/);
  if (numMatch) {
    const n = Math.max(-1000, Math.min(1000, parseInt(numMatch[1], 10) || 0));
    return { score: n, estimated: false };
  }
  const s = standingRaw.toLowerCase();
  if (/hated|nemesis|exiled|severed|betrayed|blood/.test(s))
    return { score: -750, estimated: true };
  if (/hostile|enemy|despised|wanted/.test(s))
    return { score: -550, estimated: true };
  if (/unfriendly|suspicious|wary|cold|strained|distrust/.test(s))
    return { score: -250, estimated: true };
  if (/revered|exalted|devoted|legendary|idolized/.test(s))
    return { score: 800, estimated: true };
  if (/honored|trusted|allied|loyal|respected/.test(s))
    return { score: 550, estimated: true };
  if (/friendly|warm|favored|liked|cordial/.test(s))
    return { score: 280, estimated: true };
  return { score: 0, estimated: true };
}
function reputationColor(score) {
  if (score <= -500)
    return "#e86a6a";
  if (score < -80)
    return "#e89b6a";
  if (score >= 500)
    return "#4ade80";
  if (score > 80)
    return "#7ec8f0";
  return "#c4b59d";
}
function renderReputation(root, container, expandedCards, onToggle) {
  const entries = childrenByTag(root, "ent_rep");
  if (!entries.length)
    return false;
  for (let i = 0;i < entries.length; i++) {
    const entry = entries[i];
    const name = childText(entry, "name") || "Faction";
    const scoreRaw = childText(entry, "score") || childText(entry, "value") || childText(entry, "rep");
    const standingRaw = childText(entry, "standing");
    const noteRaw = childText(entry, "note") || childText(entry, "details") || childText(entry, "reason");
    const buffRaw = childText(entry, "buff") || childText(entry, "effect") || childText(entry, "modifier");
    const { score, estimated } = parseReputationScore(scoreRaw, standingRaw);
    const color = reputationColor(score);
    const tierLabel = shortBadge(standingRaw || (score > 80 ? "Friendly" : score < -80 ? "Hostile" : "Neutral"), 24);
    const card = makeCollapsibleCard({
      cardId: `reputation:${name}:${i}`,
      icon: "⭐",
      title: name,
      badge: tierLabel,
      accentColor: color,
      expandedCards,
      onToggle
    }, (body) => {
      const meter = el("div", "la-rep-meter");
      const head = el("div", "la-rep-head");
      const tierEl = el("span", "la-rep-tier", tierLabel);
      tierEl.style.color = color;
      const scoreText = `${score > 0 ? "+" : ""}${score}${estimated ? " (est.)" : ""}`;
      head.append(tierEl, el("span", "la-rep-score", scoreText));
      const track = el("div", "la-axis-track");
      const negHalf = el("div", "la-axis-half la-axis-half-neg");
      const negFill = el("div", "la-axis-fill");
      negFill.style.width = score < 0 ? `${Math.min(100, Math.abs(score) / 1000 * 100)}%` : "0%";
      negFill.style.background = color;
      negHalf.append(negFill);
      const posHalf = el("div", "la-axis-half la-axis-half-pos");
      const posFill = el("div", "la-axis-fill");
      posFill.style.width = score > 0 ? `${Math.min(100, score / 1000 * 100)}%` : "0%";
      posFill.style.background = color;
      posHalf.append(posFill);
      track.append(negHalf, el("div", "la-axis-center"), posHalf);
      const scale = el("div", "la-rep-scale");
      scale.append(el("span", undefined, "-1000"), el("span", undefined, "0"), el("span", undefined, "+1000"));
      meter.append(head, track, scale);
      body.append(meter);
      if (standingRaw && standingRaw !== tierLabel) {
        const row = el("div", "la-card-detail");
        row.append(el("div", "la-card-detail-title", "STANDING"), el("div", "la-card-detail-text", standingRaw));
        body.append(row);
      }
      if (noteRaw) {
        const row = el("div", "la-card-detail");
        row.append(el("div", "la-card-detail-title", "NOTES"), el("div", "la-card-detail-text", noteRaw));
        body.append(row);
      }
      if (buffRaw) {
        const row = el("div", "la-card-detail");
        row.append(el("div", "la-card-detail-title", "EFFECT"), el("div", "la-card-detail-text", buffRaw));
        body.append(row);
      }
    });
    container.append(card);
  }
  return true;
}
function renderTracks(root, container) {
  const mains = childrenByTag(root, "main");
  const tracks = childrenByTag(root, "track");
  const histories = childrenByTag(root, "history");
  if (!mains.length && !tracks.length && !histories.length)
    return false;
  for (const m of mains) {
    const text = normText(m.textContent);
    if (!text || isEmptyVal(text))
      continue;
    const box = el("div", "la-flat-panel la-flat-highlight");
    box.append(el("div", "la-flat-badge", "\uD83E\uDDF5 MAIN TRACK"), el("div", "la-flat-text", text));
    container.append(box);
  }
  for (const tr of tracks) {
    const text = normText(tr.textContent);
    if (!text || isEmptyVal(text))
      continue;
    const parts = text.split("|").map((s) => s.trim()).filter(Boolean);
    const box = el("div", "la-flat-panel");
    if (parts.length >= 2) {
      const head = el("div", "la-flat-row-head");
      head.append(el("span", "la-flat-title", parts[0]));
      head.append(el("span", "la-card-badge", parts[1]));
      box.append(head);
      if (parts.length > 2)
        box.append(el("div", "la-flat-text", parts.slice(2).join(" · ")));
    } else {
      box.append(el("div", "la-flat-text", text));
    }
    container.append(box);
  }
  for (const h of histories) {
    const text = normText(h.textContent);
    if (!text || isEmptyVal(text))
      continue;
    const box = el("div", "la-flat-panel");
    box.append(el("div", "la-flat-badge", "\uD83D\uDCDC HISTORY"), el("div", "la-flat-text", text));
    container.append(box);
  }
  if (!container.children.length)
    renderEmpty(container, "tracks");
  return true;
}
function renderArc(root, container) {
  const fields = [
    ["info", "ARC OVERVIEW"],
    ["timeline", "TIMELINE"],
    ["ki", "KI · 起"],
    ["sho", "SHŌ · 承"],
    ["ten", "TEN · 転"],
    ["ketsu", "KETSU · 結"]
  ];
  let anyFound = false;
  for (const [tag, label] of fields) {
    const val = childText(root, tag);
    if (!val || isEmptyVal(val))
      continue;
    anyFound = true;
    const box = el("div", "la-flat-panel");
    box.append(el("div", "la-flat-badge", label), el("div", "la-flat-text", val));
    container.append(box);
  }
  if (!anyFound) {
    if (childrenByTag(root, "info").length || childrenByTag(root, "ki").length) {
      renderEmpty(container, "arc");
      return true;
    }
    return false;
  }
  return true;
}
function renderChekhov(root, container) {
  const groups = [
    ["chamber", "◉ CHAMBER"],
    ["locked", "\uD83D\uDD12 LOCKED"],
    ["fired", "✦ FIRED THIS TURN"]
  ];
  let matched = false;
  for (const [tag, title] of groups) {
    const sec = childrenByTag(root, tag)[0];
    if (!sec)
      continue;
    matched = true;
    const bullets = childrenByTag(sec, "bullet");
    const texts = bullets.length ? bullets.map((b) => normText(b.textContent)).filter((t) => !isEmptyVal(t)) : [normText(sec.textContent)].filter((t) => !isEmptyVal(t));
    if (!texts.length)
      continue;
    const group = el("div", "la-flat-group");
    group.append(el("div", "la-flat-group-title", title));
    for (const t of texts) {
      const item = el("div", "la-flat-panel");
      item.append(el("div", "la-flat-text", t));
      group.append(item);
    }
    container.append(group);
  }
  if (matched && !container.children.length)
    renderEmpty(container, "chekhov");
  return matched;
}
function renderLeads(root, container) {
  const groups = [
    ["active_leads", "\uD83D\uDCCC ACTIVE LEADS & JOBS"],
    ["usable", "\uD83D\uDD11 CONTACTS, LEVERAGE & HOOKS"],
    ["resolved_leads", "✓ RESOLVED THIS TURN"]
  ];
  let matched = false;
  for (const [tag, title] of groups) {
    const sec = childrenByTag(root, tag)[0];
    if (!sec)
      continue;
    matched = true;
    const leads = childrenByTag(sec, "lead");
    const texts = leads.length ? leads.map((l) => normText(l.textContent)).filter((t) => !isEmptyVal(t)) : [normText(sec.textContent)].filter((t) => !isEmptyVal(t));
    if (!texts.length)
      continue;
    const group = el("div", "la-flat-group");
    group.append(el("div", "la-flat-group-title", title));
    for (const t of texts) {
      const parts = t.split("|").map((s) => s.trim()).filter(Boolean);
      const item = el("div", "la-flat-panel");
      if (parts.length >= 3) {
        const head = el("div", "la-flat-row-head");
        head.append(el("span", "la-flat-title", parts[0]), el("span", "la-flat-meta", `· ${parts[1]}`));
        item.append(head, el("div", "la-flat-text", parts.slice(2).join(" | ")));
      } else {
        item.append(el("div", "la-flat-text", t));
      }
      group.append(item);
    }
    container.append(group);
  }
  if (matched && !container.children.length)
    renderEmpty(container, "leads");
  return matched;
}
function splitTopLevel(raw) {
  const parts = [];
  let buf = "";
  let depth = 0;
  for (const ch of raw) {
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      buf += ch;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth > 0)
        depth--;
      buf += ch;
    } else if ((ch === "," || ch === ";") && depth === 0) {
      const trimmed = buf.trim();
      if (trimmed)
        parts.push(trimmed);
      buf = "";
    } else {
      buf += ch;
    }
  }
  const tail = buf.trim();
  if (tail)
    parts.push(tail);
  return parts;
}
var CURRENCY_RE = /^(?:[$€£¥₩]\s*\d|\d[\d.,]*\s*(?:eddies|eb|eurodollars?|credits?|gold|gp|sp|cp|coins?|yen|dollars?|bucks|caps|gil|septims?)\b)/i;
function parseItemEntry(raw) {
  const match = raw.match(/^([^(]+?)\s*\(([\s\S]+)\)\s*$/);
  if (!match)
    return { main: raw, detail: "", subItems: [] };
  const main = match[1].trim();
  const inner = match[2].trim();
  const colonIdx = inner.indexOf(":");
  if (colonIdx > 0) {
    const prefix = inner.slice(0, colonIdx + 1).trim();
    const rest = inner.slice(colonIdx + 1).trim();
    const sub = splitTopLevel(rest);
    if (sub.length >= 2) {
      return { main, detail: prefix, subItems: sub };
    }
  }
  return { main, detail: inner, subItems: [] };
}
function renderInventory(root, container) {
  const slots = [
    ["inv", "\uD83C\uDF92", "ITEMS"],
    ["titles", "\uD83C\uDFF7️", "TRAITS"],
    ["status", "♥", "STATUS"]
  ];
  let matched = false;
  for (const [tag, icon, label] of slots) {
    const val = childText(root, tag);
    if (!val)
      continue;
    matched = true;
    const box = el("div", "la-flat-panel");
    box.append(el("div", "la-flat-badge", `${icon} ${label}`));
    const entries = splitTopLevel(val);
    if (tag === "inv" && entries.length > 1) {
      const currency = [];
      const containers = [];
      const regular = [];
      for (const entry of entries) {
        if (CURRENCY_RE.test(entry)) {
          currency.push(entry);
        } else {
          const parsed = parseItemEntry(entry);
          if (parsed.subItems.length > 0 || parsed.detail)
            containers.push(parsed);
          else
            regular.push(parsed);
        }
      }
      if (currency.length) {
        const curRow = el("div", "la-inv-currency-row");
        for (const c of currency)
          curRow.append(el("span", "la-inv-currency", `\uD83D\uDCB0 ${c}`));
        box.append(curRow);
      }
      const list = el("div", "la-inv-list");
      const sortedRegular = [...regular].sort((a, b) => a.main.localeCompare(b.main));
      const sortedContainers = [...containers].sort((a, b) => a.main.localeCompare(b.main));
      for (const item of [...sortedRegular, ...sortedContainers]) {
        const row = el("div", "la-inv-item");
        row.append(el("div", "la-inv-item-main", item.main));
        if (item.detail)
          row.append(el("div", "la-inv-item-detail", item.detail));
        if (item.subItems.length) {
          const ul = el("ul", "la-inv-sublist");
          for (const s of item.subItems)
            ul.append(el("li", undefined, s));
          row.append(ul);
        }
        list.append(row);
      }
      box.append(list);
    } else if ((tag === "titles" || tag === "status") && entries.length > 1) {
      const chips = el("div", "la-inv-chips");
      for (const entry of entries)
        chips.append(el("span", "la-inv-chip", entry));
      box.append(chips);
    } else {
      box.append(el("div", "la-flat-text", val));
    }
    container.append(box);
  }
  return matched;
}
function renderStoryNotes(root, container) {
  const fields = [
    ["threads", "THREADS"],
    ["seeds", "SEEDS"],
    ["motives", "MOTIVES"],
    ["horizon", "HORIZON"],
    ["GremlinNote", "GREMLIN NOTE"],
    ["heckle", "WORLD TURN"]
  ];
  let matched = false;
  for (const [tag, label] of fields) {
    const val = childText(root, tag);
    if (!val || isEmptyVal(val))
      continue;
    matched = true;
    const box = el("div", "la-flat-panel");
    box.append(el("div", "la-flat-badge", label), el("div", "la-flat-text", val));
    container.append(box);
  }
  return matched;
}
function renderNotebook(root, container) {
  const entries = [...childrenByTag(root, "ent"), ...childrenByTag(root, "note")];
  if (!entries.length)
    return false;
  for (const entry of entries) {
    const text = normText(entry.textContent);
    if (!text)
      continue;
    const row = el("div", "la-nb-row");
    row.append(el("span", "la-nb-icon", "✏️"), el("div", "la-flat-text", text));
    container.append(row);
  }
  return true;
}
function renderVent(root, container) {
  const vents = childrenByTag(root, "vent");
  const texts = vents.length ? vents.map((v) => normText(v.textContent)).filter((t) => !isEmptyVal(t)) : [normText(root.textContent)].filter((t) => !isEmptyVal(t));
  if (!texts.length) {
    renderEmpty(container, "vent");
    return true;
  }
  for (const t of texts) {
    const box = el("div", "la-flat-panel");
    box.append(el("div", "la-flat-text", t));
    container.append(box);
  }
  return true;
}
function renderGeneric(root, container, sectionId, sectionColor, collapsible, expandedCards, onToggle) {
  const children = Array.from(root.children);
  if (!children.length) {
    const text = normText(root.textContent);
    if (!text || isEmptyVal(text)) {
      renderEmpty(container, sectionId);
      return;
    }
    const box = el("div", "la-flat-panel");
    box.append(el("div", "la-flat-text", text));
    container.append(box);
    return;
  }
  for (let i = 0;i < children.length; i++) {
    const child = children[i];
    const subChildren = Array.from(child.children);
    const nameEl = subChildren.find((c) => ["name", "names", "pair", "title"].includes(c.tagName.toLowerCase()));
    const badgeEl = subChildren.find((c) => ["standing", "mode", "status", "salience"].includes(c.tagName.toLowerCase()));
    const title = nameEl ? normText(nameEl.textContent) : child.tagName.replace(/_/g, " ");
    const badge = badgeEl ? shortBadge(normText(badgeEl.textContent)) : undefined;
    const buildBody = (body) => {
      if (!subChildren.length) {
        const t = normText(child.textContent);
        if (t)
          body.append(el("div", "la-flat-text", t));
        return;
      }
      for (const sc of subChildren) {
        if (sc === nameEl)
          continue;
        const val = normText(sc.textContent);
        if (!val)
          continue;
        const row = el("div", "la-card-detail");
        row.append(el("div", "la-card-detail-title", sc.tagName.replace(/_/g, " ").toUpperCase()), el("div", "la-card-detail-text", val));
        body.append(row);
      }
    };
    if (collapsible) {
      container.append(makeCollapsibleCard({
        cardId: `${sectionId}:${title}:${i}`,
        icon: "•",
        title,
        badge,
        accentColor: sectionColor,
        expandedCards,
        onToggle
      }, buildBody));
    } else {
      const box = el("div", "la-flat-panel");
      if (subChildren.length) {
        box.append(el("div", "la-flat-badge", title.toUpperCase()));
        buildBody(box);
      } else {
        box.append(el("div", "la-flat-badge", child.tagName.replace(/_/g, " ").toUpperCase()));
        box.append(el("div", "la-flat-text", normText(child.textContent)));
      }
      container.append(box);
    }
  }
}
function renderStateSection(opts) {
  const { sectionId, sectionLabel, sectionColor, collapsible, raw, container, expandedCards, onToggle } = opts;
  const { root, blocked } = parseSectionXml(raw);
  if (blocked) {
    renderEmpty(container, sectionLabel);
    return;
  }
  if (!root) {
    const fallback = normText(raw);
    if (!fallback || isEmptyVal(fallback)) {
      renderEmpty(container, sectionLabel);
      return;
    }
    const box = el("div", "la-flat-panel");
    box.append(el("div", "la-flat-text", fallback));
    container.append(box);
    return;
  }
  let handled = false;
  switch (sectionId) {
    case "world":
      handled = renderWorld(root, container);
      break;
    case "onscreen":
      handled = renderOnScreen(root, container, expandedCards, onToggle);
      break;
    case "offscreen_agendas":
      handled = renderOffScreen(root, container, expandedCards, onToggle);
      break;
    case "locations":
      handled = renderLocations(root, container, expandedCards, onToggle);
      break;
    case "entityMem":
      handled = renderEntityMemory(root, container, expandedCards, onToggle);
      break;
    case "entity_state":
      handled = renderEntityProfile(root, container, expandedCards, onToggle);
      break;
    case "thoughts":
      handled = renderThoughts(root, container, expandedCards, onToggle);
      break;
    case "dam":
      handled = renderDams(root, container, expandedCards, onToggle);
      break;
    case "pair":
      handled = renderPairs(root, container, expandedCards, onToggle);
      break;
    case "reputation":
      handled = renderReputation(root, container, expandedCards, onToggle);
      break;
    case "tracks":
      handled = renderTracks(root, container);
      break;
    case "arc":
      handled = renderArc(root, container);
      break;
    case "chekhov":
      handled = renderChekhov(root, container);
      break;
    case "leads":
      handled = renderLeads(root, container);
      break;
    case "inv":
      handled = renderInventory(root, container);
      break;
    case "story_notes":
      handled = renderStoryNotes(root, container);
      break;
    case "notebook":
      handled = renderNotebook(root, container);
      break;
    case "vent":
      handled = renderVent(root, container);
      break;
  }
  if (!handled) {
    renderGeneric(root, container, sectionId, sectionColor, collapsible, expandedCards, onToggle);
  }
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
  font-family: var(--lumiverse-font-family, system-ui, -apple-system, sans-serif);
  font-size: calc(13px * var(--lumiverse-font-scale, 1));
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
.la-location { font-size: 1.08em; font-weight: 700; color: #f0ebe4; }
.la-subtitle { font-size: 0.85em; color: #8a8078; }
.la-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.la-btn {
  appearance: none;
  border: 1px solid #3a332a;
  background: #1a1612;
  color: #d4ccc0;
  border-radius: 6px;
  padding: 3px 8px;
  font: inherit;
  font-size: 0.92em;
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
.la-field { display: flex; flex-direction: column; gap: 3px; font-size: 0.85em; font-weight: 600; color: #8a8078; }
.la-select { width: 100%; padding: 4px 6px; border-radius: 5px; border: 1px solid #3a332a; background: #0f0d0b; color: #d4ccc0; font: inherit; font-size: 0.92em; }
.la-toggles { display: flex; gap: 10px; flex-wrap: wrap; }
.la-check { display: inline-flex; align-items: center; gap: 4px; font-size: 0.92em; font-weight: 500; cursor: pointer; color: #c4bcb0; }
.la-check input { accent-color: #c4973c; width: 13px; height: 13px; margin: 0; }

/* ── Banners ── */
.la-banner { padding: 5px 8px; border-radius: 6px; font-size: 0.92em; border: 1px solid #3a332a; background: #1a1612; }
.la-banner[hidden] { display: none; }
.la-banner-error { border-color: #8a4040; background: rgba(138,64,64,0.1); color: #e8a0a0; }
.la-banner-stale { border-color: #c4973c; background: rgba(196,151,60,0.08); color: #e8d5a0; }

/* ── Thinking ── */
.la-thinking { border: 1px solid #2a2520; border-radius: 8px; background: #14110e; overflow: hidden; }
.la-thinking[hidden] { display: none; }
.la-thinking-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 5px 8px; background: rgba(196,151,60,0.06); border-bottom: 1px solid #2a2520; cursor: pointer; user-select: none; }
.la-thinking-title { display: flex; align-items: center; gap: 5px; font-size: 0.92em; font-weight: 600; color: #d4c4a0; }
.la-thinking-dot { width: 5px; height: 5px; border-radius: 50%; background: #c4973c; flex: none; }
.la-thinking-dot.la-pulse { animation: la-pulse 1.2s ease-in-out infinite; }
@keyframes la-pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
.la-thinking-meta { font-size: 0.85em; color: #8a8078; }
.la-thinking-body { margin: 0; padding: 6px 8px; max-height: 100px; overflow-y: auto; font-family: ui-monospace, monospace; font-size: 0.85em; line-height: 1.4; white-space: pre-wrap; word-break: break-word; color: #a09890; background: #0f0d0b; }
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
.la-section-title { font-size: 0.92em; font-weight: 700; color: #d4c4a0; display: flex; align-items: center; gap: 5px; }
.la-section-icon { font-size: 1em; }
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
  font-size: 0.85em; color: #b0a898;
}
.la-status-badge .la-icon { font-size: 0.85em; }

/* ── Sidebar + Content layout ── */
.la-state-layout {
  display: flex; min-height: 0; flex: 1;
}
.la-sidebar {
  width: 10.5em; flex: none;
  border-right: 1px solid #2a2520;
  overflow-y: auto;
  padding: 0.35em 0;
}
.la-sidebar-category {
  padding: 0.45em 0.7em 0.2em;
  font-size: 0.75em; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: #6a6058;
}
.la-sidebar-item {
  display: flex; align-items: center; gap: 0.45em;
  padding: 0.32em 0.65em; cursor: pointer;
  font-size: 0.92em; color: #a09890;
  border-left: 2px solid transparent;
  transition: background 80ms, border-color 80ms;
}
.la-sidebar-item:hover { background: rgba(196,151,60,0.06); }
.la-sidebar-item.la-active {
  background: rgba(196,151,60,0.1);
  border-left-color: #c4973c;
  color: #e8d5a0;
}
.la-sidebar-icon { min-width: 1.45em; text-align: center; flex: none; font-size: 1em; line-height: 1.1; }
.la-state-content {
  flex: 1; min-width: 0;
  overflow-y: auto;
  padding: 0.55em;
}

/* ── Collapsible cards & native Vexa GFX ── */
.la-card {
  margin-bottom: 0.45em;
  border: 1px solid #2d2620;
  border-radius: 7px;
  background: #181411;
  overflow: hidden;
}
.la-card-open { border-color: #c4973c; }
.la-card-head {
  display: flex; align-items: center; flex-wrap: wrap; gap: 0.4em 0.55em;
  padding: 0.65em 0.8em;
  min-height: 2.75em;
  cursor: pointer;
  transition: background 80ms;
}
.la-card-head:hover { background: rgba(196,151,60,0.05); }
.la-card-head.la-expanded {
  border-bottom: 1px solid #2d2620;
  background: rgba(196,151,60,0.08);
}
.la-card-chevron { font-size: 0.95em; color: #c4973c; width: 1.1em; text-align: center; flex: none; }
.la-card-icon { font-size: 1.1em; min-width: 1.35em; text-align: center; line-height: 1.1; flex: none; }
.la-card-name { font-weight: 700; font-size: 1em; color: #ece5da; flex: 1 1 8em; min-width: 0; overflow-wrap: break-word; word-break: normal; }
.la-loc-id { font-family: var(--lumiverse-font-mono, ui-monospace, monospace); font-size: 0.78em; color: #8a8078; background: #231e19; padding: 1px 4px; border-radius: 3px; }
.la-card-badge {
  font-size: 0.78em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  padding: 0.16em 0.55em; border-radius: 999px; flex: 0 1 auto; max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: #252018; border: 1px solid #4a3d2e; color: #d4b886;
}
.la-card-body { padding: 7px 9px; display: flex; flex-direction: column; gap: 6px; }
.la-card-subtext { font-size: 0.9em; color: #b8afa3; white-space: normal; overflow-wrap: anywhere; }
.la-card-location { font-size: 0.86em; color: #c4b59d; }
.la-card-detail {
  padding: 5px 7px; background: rgba(196,151,60,0.04);
  border-radius: 5px; border: 1px solid #28221c; border-left: 2px solid #c4973c;
}
.la-card-detail-title { font-size: 0.75em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #9c8f80; margin-bottom: 2px; }
.la-card-detail-text { font-size: 0.92em; color: #dcd4c8; white-space: normal; overflow-wrap: anywhere; }
.la-card-footer { font-size: 0.8em; color: #8a8078; border-top: 1px solid #26201a; padding-top: 4px; }

/* ── World HUD & Flat panels ── */
.la-world-hud { display: flex; flex-direction: column; gap: 6px; }
.la-world-bar { display: flex; flex-wrap: wrap; gap: 4px; }
.la-world-pill { padding: 2px 7px; border-radius: 5px; background: #1c1713; border: 1px solid #2f2821; font-size: 0.84em; color: #d4ccc0; }
.la-world-ct { border-color: #c4973c; color: #e8d5a0; font-weight: 700; }
.la-world-pacing { border-color: #6a8ae8; color: #b8ccf4; font-weight: 600; }
.la-flat-group { display: flex; flex-direction: column; gap: 5px; margin-bottom: 8px; }
.la-flat-group-title { font-size: 0.78em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #c4973c; padding: 2px 2px 0; }
.la-flat-panel {
  padding: 7px 9px; margin-bottom: 5px;
  border: 1px solid #2d2620; border-radius: 7px; background: #181411;
  display: flex; flex-direction: column; gap: 4px;
}
.la-flat-highlight { border-left: 2px solid #c4973c; background: rgba(196,151,60,0.05); }
.la-flat-badge {
  display: inline-flex; align-items: center; gap: 4px; align-self: flex-start;
  padding: 1px 7px; border-radius: 999px;
  background: #231e19; border: 1px solid #3a3128;
  font-size: 0.76em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #c8bfb2;
}
.la-flat-row-head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; flex-wrap: wrap; }
.la-flat-title { font-weight: 700; font-size: 0.94em; color: #efe8de; }
.la-flat-meta { font-size: 0.84em; color: #9c9082; }
.la-flat-text { font-size: 0.92em; color: #ddd5c9; white-space: normal; overflow-wrap: anywhere; line-height: 1.48; }

/* ── Metadata chips, Memory, Profile KV ── */
.la-meta-bar { display: flex; flex-wrap: wrap; gap: 4px; }
.la-meta-chip { padding: 1px 6px; border-radius: 999px; background: #221d18; border: 1px solid #352d25; font-size: 0.8em; color: #c4bcb0; }
.la-meta-mono { font-family: var(--lumiverse-font-mono, ui-monospace, monospace); color: #d4b886; }
.la-mem-entry { padding: 5px 7px; border-radius: 5px; background: #14110e; border: 1px solid #28221c; display: flex; flex-direction: column; gap: 4px; }
.la-mem-fact { font-size: 0.92em; color: #ddd5c9; white-space: normal; overflow-wrap: anywhere; }
.la-mem-cert { border-color: #4a6a50; color: #9ad8a6; }
.la-kv-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(11em, 1fr)); gap: 5px; }
.la-kv-cell { padding: 4px 6px; border-radius: 5px; background: #14110e; border: 1px solid #28221c; }
.la-kv-k { font-size: 0.76em; font-weight: 700; text-transform: uppercase; color: #8a8078; }
.la-kv-v { font-size: 0.9em; color: #d8d0c4; overflow-wrap: anywhere; }
.la-color-row { display: flex; align-items: center; gap: 6px; }
.la-color-swatch { width: 12px; height: 12px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.25); flex: none; }

/* ── Inventory structured list & chips ── */
.la-inv-currency-row { display: flex; flex-wrap: wrap; gap: 0.35em; margin-bottom: 0.3em; }
.la-inv-currency {
  display: inline-flex; align-items: center; gap: 0.3em;
  padding: 0.18em 0.55em; border-radius: 999px;
  background: rgba(196,151,60,0.14); border: 1px solid #c4973c;
  font-size: 0.88em; font-weight: 700; color: #f0cf80;
}
.la-inv-list { display: flex; flex-direction: column; gap: 0.32em; }
.la-inv-item {
  padding: 0.38em 0.55em; border-radius: 5px;
  background: #14110e; border: 1px solid #28221c;
  display: flex; flex-direction: column; gap: 0.2em;
}
.la-inv-item-main { font-size: 0.92em; font-weight: 600; color: #ece5da; overflow-wrap: anywhere; }
.la-inv-item-detail { font-size: 0.86em; color: #b6ada0; padding-left: 0.6em; border-left: 2px solid #3a3128; overflow-wrap: anywhere; line-height: 1.4; }
.la-inv-sublist { margin: 0.15em 0 0; padding-left: 1.1em; display: flex; flex-direction: column; gap: 0.12em; font-size: 0.86em; color: #c4bcb0; }
.la-inv-chips { display: flex; flex-wrap: wrap; gap: 0.35em; }
.la-inv-chip {
  padding: 0.2em 0.55em; border-radius: 5px;
  background: #14110e; border: 1px solid #2e2720;
  font-size: 0.88em; color: #ddd5c9; overflow-wrap: anywhere;
}

/* ── Notebook rows ── */
.la-nb-row {
  display: flex; align-items: flex-start; gap: 7px;
  padding: 7px 9px; margin-bottom: 5px;
  border: 1px solid #2d2620; border-radius: 7px; background: #181411;
}
.la-nb-icon { flex: none; font-size: 0.92em; color: #e89b4e; line-height: 1.45; }

/* ── Pair bidirectional metric bars ── */
.la-axis-stack { display: flex; flex-direction: column; gap: 7px; }
.la-axis-row { display: flex; flex-direction: column; gap: 3px; }
.la-axis-labels { display: flex; justify-content: space-between; gap: 6px; font-size: 0.84em; flex-wrap: wrap; }
.la-axis-side { display: inline-flex; align-items: baseline; gap: 4px; font-weight: 600; }
.la-axis-neg { color: #e8907e; }
.la-axis-pos { color: #8ec8f2; }
.la-axis-acc { font-size: 0.85em; font-weight: 400; color: #8a8078; }
.la-axis-track { display: flex; align-items: center; height: 8px; background: #241f1a; border-radius: 4px; overflow: hidden; }
.la-axis-half { flex: 1; height: 100%; display: flex; }
.la-axis-half-neg { justify-content: flex-end; }
.la-axis-half-pos { justify-content: flex-start; }
.la-axis-center { width: 2px; height: 100%; background: #4a4036; flex: none; }
.la-axis-fill { height: 100%; border-radius: 3px; }
.la-rep-meter { display: flex; flex-direction: column; gap: 4px; padding: 4px 2px; }
.la-rep-head { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; font-size: 0.84em; }
.la-rep-tier { font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.la-rep-score { font-family: var(--lumiverse-font-mono, ui-monospace, monospace); font-size: 0.88em; color: #b8afa3; }
.la-rep-scale { display: flex; justify-content: space-between; font-size: 0.72em; color: #7a7066; }
.la-stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(7.5em, 1fr)); gap: 6px; }
.la-stat-cell { display: flex; flex-direction: column; gap: 3px; padding: 4px 6px; border-radius: 5px; background: #1c1713; border: 1px solid #2b241d; }
.la-stat-head { display: flex; justify-content: space-between; font-size: 0.82em; color: #dcd4c8; }
.la-stat-track { height: 5px; border-radius: 3px; background: #26201a; overflow: hidden; }
.la-stat-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, #b88b3a, #e2b857); }

/* ── Dams dashboard (Sluices, Flags, Filters, Intent) ── */
.la-dam-top { display: grid; grid-template-columns: repeat(auto-fit, minmax(11em, 1fr)); gap: 6px; }
.la-dam-block { padding: 6px 7px; background: #14110e; border-radius: 6px; border: 1px solid #28221c; display: flex; flex-direction: column; gap: 5px; }
.la-dam-block-title { font-size: 0.74em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8078; }
.la-dam-ctrl { display: flex; flex-direction: column; gap: 3px; }
.la-dam-ctrl-name { font-size: 0.82em; font-weight: 700; color: #cfc6b9; }
.la-dam-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; }
.la-dam-opts-4 { grid-template-columns: repeat(4, 1fr); }
.la-dam-opt { text-align: center; font-size: 0.72em; font-weight: 700; padding: 2px 3px; border-radius: 4px; background: #1d1814; border: 1px solid #2d2620; color: #6a6058; }
.la-opt-amber { background: rgba(196,151,60,0.18); border-color: #c4973c; color: #f0c975; }
.la-opt-green { background: rgba(74,222,128,0.14); border-color: #4ade80; color: #86efac; }
.la-opt-red { background: rgba(232,106,106,0.16); border-color: #e86a6a; color: #fca5a5; }
.la-opt-blue { background: rgba(96,165,250,0.16); border-color: #60a5fa; color: #93c5fd; }
.la-opt-neutral { background: rgba(255,255,255,0.08); border-color: #7a7068; color: #e8e4df; }
.la-dam-filter-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(11em, 1fr)); gap: 5px; }
.la-dam-filter-cell { padding: 5px 6px; background: #181411; border-radius: 5px; border: 1px solid #2a241e; display: flex; flex-direction: column; gap: 4px; }
.la-dam-filter-head { display: flex; justify-content: space-between; align-items: center; gap: 4px; }
.la-dam-counter { font-size: 0.76em; font-weight: 700; color: #d4a84e; }
.la-dam-intent { padding: 5px 7px; font-size: 0.9em; color: #ddd5c9; background: rgba(196,151,60,0.05); border: 1px solid #2d2620; border-radius: 5px; overflow-wrap: anywhere; }
.la-dam-intent-label { font-weight: 700; color: #d4a84e; }

/* ── Thoughts Q&A cards ── */
.la-qa-card { padding: 6px 8px; border-radius: 6px; border: 1px solid #2d2620; display: flex; flex-direction: column; gap: 3px; }
.la-qa-odd { background: #14110e; margin-right: 10px; }
.la-qa-even { background: #1d1713; margin-left: 10px; }
.la-qa-head { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.la-qa-badge { display: inline-block; font-size: 0.74em; font-weight: 700; padding: 0 5px; border-radius: 999px; background: rgba(167,139,250,0.16); color: #c4b5fd; border: 1px solid #a78bfa; flex: none; }
.la-qa-question { font-size: 0.9em; font-weight: 700; color: #eed89c; }
.la-qa-answer { font-size: 0.92em; color: #e2dad0; white-space: normal; overflow-wrap: anywhere; }

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
.la-empty-overlay strong { color: #d4ccc0; font-size: 1em; }
.la-hud-corner { position: absolute; right: 6px; bottom: 6px; display: flex; gap: 3px; z-index: 2; }
.la-hud-floors {
  position: absolute; left: 6px; bottom: 6px; z-index: 2;
  display: inline-flex; gap: 3px; align-items: center;
  padding: 2px 3px; border-radius: 6px;
  background: rgba(15,13,11,0.82); border: 1px solid #2a2520;
}
.la-hud-floors:empty { display: none; }
.la-hud-badge { position: absolute; left: 6px; top: 6px; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; font-weight: 600; background: rgba(15,13,11,0.82); border: 1px solid #2a2520; color: #b0a898; pointer-events: none; }

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
.la-insp-title { font-size: 1em; font-weight: 700; color: #f0ebe4; }
.la-pill-row { display: flex; gap: 3px; flex-wrap: wrap; }
.la-pill { font-size: 0.75em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 5px; border-radius: 3px; background: #252018; color: #b0a090; border: 1px solid #3a332a; }
.la-pill-current { background: rgba(196,151,60,0.12); color: #d4b44e; border-color: #c4973c; }
.la-pill-locked { background: rgba(244,114,182,0.1); color: #f0a0c0; border-color: #8a4060; }
.la-insp-summary { margin: 0; font-size: 0.92em; color: #c4bcb0; }
.la-insp-section-label { font-size: 0.75em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #6a6058; }
.la-feature-list { margin: 0; padding-left: 12px; display: grid; gap: 1px; font-size: 0.92em; color: #b0a898; }
.la-chip-row { display: flex; gap: 4px; flex-wrap: wrap; }
.la-pin-chip { display: inline-flex; align-items: center; gap: 3px; padding: 1px 5px; border-radius: 4px; background: #252018; border: 1px solid #3a332a; font-size: 0.85em; color: #d4ccc0; }
.la-pin-dot { width: 5px; height: 5px; border-radius: 50%; flex: none; }
.la-neighbor-btn { appearance: none; border: 1px solid #3a332a; background: #252018; color: #c4bcb0; border-radius: 4px; padding: 1px 5px; font: inherit; font-size: 0.85em; cursor: pointer; }
.la-neighbor-btn:hover { border-color: #c4973c; color: #e8d5a0; }
.la-notes { font-size: 0.85em; color: #6a6058; border-top: 1px solid #2a2520; padding-top: 4px; }

/* ── Ledger ── */
.la-ledger-body { padding: 6px 8px; }
.la-ledger-empty { color: #6a6058; font-size: 0.92em; text-align: center; padding: 10px; }
.la-ledger-content { font-size: 0.92em; white-space: pre-wrap; overflow-wrap: anywhere; color: #c4bcb0; }
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
function el2(tag, className, text) {
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
  const root = el2("div", "la-root");
  const header = el2("div", "la-header");
  const titleGroup = el2("div", "la-title-group");
  const locationEl = el2("div", "la-location", "LumiAtlas");
  const subtitleEl = el2("div", "la-subtitle", "Loading…");
  titleGroup.append(locationEl, subtitleEl);
  const actions = el2("div", "la-actions");
  const analyzeBtn = el2("button", "la-btn la-btn-primary", "Analyze");
  const rebuildBtn = el2("button", "la-btn", "Rebuild");
  const cancelBtn = el2("button", "la-btn la-btn-danger", "Cancel");
  cancelBtn.hidden = true;
  const settingsBtn = el2("button", "la-btn", "Settings");
  actions.append(analyzeBtn, rebuildBtn, cancelBtn, settingsBtn);
  header.append(titleGroup, actions);
  const settingsBox = el2("div", "la-settings");
  settingsBox.hidden = true;
  const connField = el2("label", "la-field", "Background Model");
  const connSelect = el2("select", "la-select");
  connField.append(connSelect);
  const toggles = el2("div", "la-toggles");
  const enabledLabel = el2("label", "la-check");
  const enabledInput = el2("input");
  enabledInput.type = "checkbox";
  enabledLabel.append(enabledInput, document.createTextNode("Enable"));
  const autoLabel = el2("label", "la-check");
  const autoInput = el2("input");
  autoInput.type = "checkbox";
  autoLabel.append(autoInput, document.createTextNode("Auto-update"));
  const reasoningLabel = el2("label", "la-check");
  const reasoningInput = el2("input");
  reasoningInput.type = "checkbox";
  reasoningLabel.append(reasoningInput, document.createTextNode("Thinking"));
  const refreshBtn = el2("button", "la-btn", "Reload");
  toggles.append(enabledLabel, autoLabel, reasoningLabel, refreshBtn);
  settingsBox.append(connField, toggles);
  const errorBanner = el2("div", "la-banner la-banner-error");
  errorBanner.hidden = true;
  const staleBanner = el2("div", "la-banner la-banner-stale");
  staleBanner.hidden = true;
  const thinkingBox = el2("div", "la-thinking");
  thinkingBox.hidden = true;
  const thinkingHead = el2("div", "la-thinking-head");
  const thinkingTitle = el2("div", "la-thinking-title");
  const thinkingDot = el2("span", "la-thinking-dot la-pulse");
  const thinkingLabel = el2("span", undefined, "Model thinking…");
  thinkingTitle.append(thinkingDot, thinkingLabel);
  const thinkingMeta = el2("span", "la-thinking-meta", "");
  thinkingHead.append(thinkingTitle, thinkingMeta);
  const thinkingBody = el2("pre", "la-thinking-body", "");
  thinkingBox.append(thinkingHead, thinkingBody);
  const browser = el2("div", "la-browser");
  const mapSection = el2("div", "la-section la-map-section");
  const mapHead = el2("div", "la-section-head");
  const mapTitle = el2("div", "la-section-title");
  mapTitle.append(el2("span", "la-section-icon", "\uD83D\uDDFA"), el2("span", undefined, "Map"));
  mapHead.append(mapTitle);
  const mapControls = el2("div", "la-map-controls");
  const scaleField = el2("label", "la-field", "Scale");
  const scaleSelect = el2("select", "la-select");
  scaleSelect.setAttribute("aria-label", "Map scale");
  for (const [value, label] of [["local", "Local"], ["region", "Region"], ["world", "World"]]) {
    const opt = el2("option", undefined, label);
    opt.value = value;
    scaleSelect.append(opt);
  }
  scaleField.append(scaleSelect);
  const zoneField = el2("label", "la-field", "Zone");
  const zoneSelect = el2("select", "la-select");
  zoneSelect.setAttribute("aria-label", "Zone map");
  zoneField.append(zoneSelect);
  mapControls.append(scaleField, zoneField);
  const canvasWrap = el2("div", "la-canvas-wrap");
  const svg = svgEl("svg", { class: "la-svg", viewBox: "-50 -50 100 100", preserveAspectRatio: "xMidYMid meet" });
  const hudBadge = el2("div", "la-hud-badge", "Local");
  const hudCorner = el2("div", "la-hud-corner");
  const zoomInBtn = el2("button", "la-btn la-btn-icon", "+");
  zoomInBtn.title = "Zoom in";
  const zoomOutBtn = el2("button", "la-btn la-btn-icon", "−");
  zoomOutBtn.title = "Zoom out";
  const fitBtn = el2("button", "la-btn la-btn-icon", "Fit");
  fitBtn.title = "Fit map";
  hudCorner.append(zoomOutBtn, zoomInBtn, fitBtn);
  const floorBar = el2("div", "la-hud-floors");
  floorBar.setAttribute("aria-label", "Map floors");
  const emptyOverlay = el2("div", "la-empty-overlay");
  canvasWrap.append(svg, hudBadge, floorBar, hudCorner, emptyOverlay);
  const mapToolbar = el2("div", "la-map-toolbar");
  const pinsToggle = el2("button", "la-btn la-btn-active", "Pins");
  const roadsToggle = el2("button", "la-btn la-btn-active", "Roads");
  const labelsToggle = el2("button", "la-btn la-btn-active", "Labels");
  mapToolbar.append(pinsToggle, roadsToggle, labelsToggle);
  const inspector = el2("div", "la-inspector");
  const mapBody = el2("div", "la-section-body");
  mapBody.append(mapControls, canvasWrap, mapToolbar, inspector);
  mapSection.append(mapHead, mapBody);
  const statesSection = el2("div", "la-section");
  const statesHead = el2("div", "la-section-head");
  const statesTitle = el2("div", "la-section-title");
  statesTitle.append(el2("span", "la-section-icon", "\uD83D\uDCCA"), el2("span", undefined, "Internal States"));
  statesHead.append(statesTitle);
  const statusBar = el2("div", "la-status-bar");
  const stateLayout = el2("div", "la-state-layout");
  const sidebar = el2("div", "la-sidebar");
  const stateContent = el2("div", "la-state-content");
  for (const category of CATEGORIES) {
    const sections = STATE_SECTIONS.filter((s) => s.category === category);
    if (!sections.length)
      continue;
    sidebar.append(el2("div", "la-sidebar-category", category));
    for (const section of sections) {
      const item = el2("div", "la-sidebar-item");
      item.setAttribute("data-section", section.id);
      const icon = el2("span", "la-sidebar-icon", section.icon);
      icon.style.color = section.color;
      item.append(icon, el2("span", undefined, section.label));
      sidebar.append(item);
    }
  }
  stateLayout.append(sidebar, stateContent);
  const statesBody = el2("div", "la-section-body");
  statesBody.append(statusBar, stateLayout);
  statesSection.append(statesHead, statesBody);
  const ledgerSection = el2("div", "la-section");
  const ledgerHead = el2("div", "la-section-head");
  const ledgerTitle = el2("div", "la-section-title");
  ledgerTitle.append(el2("span", "la-section-icon", "\uD83D\uDCD2"), el2("span", undefined, "Ledger"));
  ledgerHead.append(ledgerTitle);
  const ledgerBody = el2("div", "la-section-body la-ledger-body");
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
      emptyOverlay.replaceChildren(el2("strong", undefined, "Open a roleplay chat"), el2("span", undefined, "LumiAtlas tracks states per chat."));
      return;
    }
    hudBadge.textContent = layer && layer.tiles.length > 0 ? `${layer.name}${state.scale === "local" ? ` · F${state.floor}` : ""} (${tiles.length})` : state.scale.toUpperCase();
    if (!layer || tiles.length === 0) {
      emptyOverlay.hidden = false;
      emptyOverlay.replaceChildren(el2("strong", undefined, `No ${state.scale} tiles yet`), el2("span", undefined, state.config.connectionId ? "Click Analyze to generate." : "Pick a model in Settings, then Analyze."));
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
      inspector.append(el2("div", "la-subtitle", "Select a tile to inspect."));
      return;
    }
    const visible = getVisibleTiles(layer, state.floor);
    const tile = visible.find((t) => t.id === state.selectedTileId) ?? visible.find((t) => t.id === layer.currentTileId) ?? visible[0];
    if (!tile)
      return;
    const head = el2("div", "la-insp-head");
    head.append(el2("div", "la-insp-title", tile.name));
    const pills = el2("div", "la-pill-row");
    const statusClass = tile.status === "current" || layer.currentTileId === tile.id ? "la-pill la-pill-current" : tile.status === "locked" || tile.status === "unexplored" ? "la-pill la-pill-locked" : "la-pill";
    pills.append(el2("span", statusClass, layer.currentTileId === tile.id ? "here" : tile.status));
    pills.append(el2("span", "la-pill", tile.kind));
    if (tile.sizeLabel)
      pills.append(el2("span", "la-pill", tile.sizeLabel));
    head.append(pills);
    inspector.append(head);
    if (tile.summary)
      inspector.append(el2("p", "la-insp-summary", tile.summary));
    if (tile.features.length > 0 && tile.status !== "locked" && tile.status !== "unexplored") {
      inspector.append(el2("div", "la-insp-section-label", "Features & Hooks"));
      const ul = el2("ul", "la-feature-list");
      for (const feat of tile.features)
        ul.append(el2("li", undefined, feat));
      inspector.append(ul);
    }
    if (tile.pins.length > 0) {
      inspector.append(el2("div", "la-insp-section-label", "Characters Here"));
      const row = el2("div", "la-chip-row");
      for (const pin of tile.pins) {
        const chip = el2("span", "la-pin-chip");
        const dot = el2("span", "la-pin-dot");
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
      inspector.append(el2("div", "la-insp-section-label", "Connected Routes"));
      const row = el2("div", "la-chip-row");
      for (const n of neighbors) {
        const btn = el2("button", "la-neighbor-btn", n.floor !== tile.floor ? `${n.name} (F${n.floor})` : n.name);
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
      inspector.append(el2("div", "la-notes", state.atlas.notes.join(" · ")));
    }
  }
  function renderStatusBar() {
    statusBar.replaceChildren();
    if (!state.internalState)
      return;
    const world = state.internalState.sections.world ?? "";
    const extract = (tag) => {
      const match = world.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
      return (match?.[1] ?? "").replace(/\u2800+/g, " ").replace(/[ \t]+/g, " ").trim();
    };
    const time = extract("time");
    const date = extract("date");
    const loc = extract("loc");
    const weather = extract("weather");
    if (time)
      statusBar.append(el2("span", "la-status-badge", `\uD83D\uDD50 ${time}`));
    if (date)
      statusBar.append(el2("span", "la-status-badge", `\uD83D\uDCC5 ${date}`));
    if (loc)
      statusBar.append(el2("span", "la-status-badge", `\uD83D\uDCCD ${loc}`));
    if (weather)
      statusBar.append(el2("span", "la-status-badge", weather));
  }
  function renderStateContent() {
    stateContent.replaceChildren();
    if (!state.activeChatId) {
      stateContent.append(el2("p", "la-subtitle", "Open a chat to view states."));
      return;
    }
    if (state.internalLoading) {
      stateContent.append(el2("p", "la-subtitle", "Loading states…"));
      return;
    }
    if (state.internalInvalid || state.error && !state.internalState) {
      stateContent.append(el2("p", "la-subtitle", "Unable to load states."));
      return;
    }
    if (!state.internalState) {
      stateContent.append(el2("p", "la-subtitle", "No states available for this chat."));
      return;
    }
    const section = STATE_SECTIONS.find((s) => s.id === state.stateSection);
    if (!section)
      return;
    const raw = state.internalState.sections[section.id] ?? "";
    if (!raw.trim()) {
      stateContent.append(el2("p", "la-subtitle", `No ${section.label.toLowerCase()} data available.`));
      return;
    }
    renderStateSection({
      sectionId: section.id,
      sectionLabel: section.label,
      sectionColor: section.color,
      collapsible: section.collapsible,
      raw,
      container: stateContent,
      expandedCards: state.expandedCards,
      onToggle: renderStateContent
    });
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
      ledgerBody.append(el2("div", "la-ledger-empty", "Open a chat to view the ledger."));
      return;
    }
    if (state.internalLoading) {
      ledgerBody.append(el2("div", "la-ledger-empty", "Loading…"));
      return;
    }
    const content = state.internalState ? revealedLedger(state.internalState.ledger) : null;
    if (content) {
      ledgerBody.append(el2("div", "la-ledger-content", content));
    } else {
      ledgerBody.append(el2("div", "la-ledger-empty", "No revealed Ledger available."));
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
    const blank = el2("option", undefined, state.connections.length ? "— Select a connection —" : "No connections available");
    blank.value = "";
    connSelect.append(blank);
    for (const c of state.connections) {
      const opt = el2("option", undefined, c.model ? `${c.name} (${c.model})` : c.name);
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
          thinkingBody.textContent = `Atlas JSON (${outChars} chars)…
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
      const empty = el2("option", undefined, "No maps available");
      empty.value = "";
      zoneSelect.append(empty);
    } else {
      const activeId = state.atlas?.maps?.[state.scale]?.id ?? null;
      for (const l of layers) {
        const isCurrent = l.id === activeId;
        const opt = el2("option", undefined, `${l.name} (${l.tiles.length} ${l.tiles.length === 1 ? "tile" : "tiles"})${isCurrent ? " · Current" : ""}`);
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
          const btn = el2("button", `la-btn${state.floor === f ? " la-btn-active" : ""}`, `F${f}`);
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
