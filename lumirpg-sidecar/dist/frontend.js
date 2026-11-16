// src/frontend.ts
var icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5.5 9 3l6 2.5L21 3v15.5L15 21l-6-2.5-6 2.5V5.5Zm6 11.2 6 2.5V7.3L9 4.8v11.9Zm-4 1.2 2-.8V5L5 5.8v12.1Zm14-1.2V5.8l-2 .8v12.1l2-.8Z"/></svg>';
var svgNamespace = "http://www.w3.org/2000/svg";
var instanceSerial = 0;
function element(tag, className, text) {
  const result = document.createElement(tag);
  if (className)
    result.className = className;
  if (text !== undefined)
    result.textContent = text;
  return result;
}
function svgElement(tag) {
  return document.createElementNS(svgNamespace, tag);
}
function text(value, fallback = "") {
  if (typeof value === "string" && value.trim())
    return value.trim();
  if (typeof value === "number" && Number.isFinite(value))
    return String(value);
  return fallback;
}
function isPrivate(tile) {
  if (!tile || tile.hidden !== false)
    return true;
  const status = text(tile.status).toLowerCase().replace(/[_-]+/g, " ");
  const kind = text(tile.kind).toLowerCase().replace(/[_-]+/g, " ");
  return !status || /^(unknown|hidden|undiscovered|unexplored|not (?:yet )?(?:discovered|explored|revealed))\b/.test(status) || /^(unknown|hidden|undiscovered|unexplored)\b/.test(kind);
}
function privateNames(state) {
  if (!state?.maps)
    return [];
  const names = [];
  for (const scale of ["local", "region", "world"]) {
    const tiles = state.maps[scale]?.tiles;
    if (!Array.isArray(tiles))
      continue;
    for (const tile of tiles) {
      if (!isPrivate(tile))
        continue;
      const name = text(tile?.name);
      if (name && !/^(unknown|hidden|undiscovered|unexplored|\?)$/i.test(name))
        names.push(name.toLocaleLowerCase());
    }
  }
  return names;
}
function publicText(value, fallback, forbidden) {
  const result = text(value);
  if (!result)
    return fallback;
  const lower = result.toLocaleLowerCase();
  if (forbidden.some((name) => lower === name || name.length >= 3 && lower.includes(name)))
    return fallback;
  return result;
}
function validGeometry(tile) {
  return typeof tile.id === "string" && !!tile.id && [tile.x, tile.y, tile.w, tile.h].every((value) => typeof value === "number" && Number.isFinite(value)) && tile.x >= -50 && tile.x <= 50 && tile.y >= -50 && tile.y <= 50 && tile.w > 0 && tile.w <= 100 && tile.h > 0 && tile.h <= 100 && tile.x + tile.w <= 50 && tile.y + tile.h <= 50;
}
function visibleTiles(map) {
  const result = [];
  const ids = new Set;
  if (!Array.isArray(map?.tiles))
    return result;
  for (const tile of map.tiles) {
    if (!tile || isPrivate(tile) || !validGeometry(tile) || ids.has(tile.id))
      continue;
    ids.add(tile.id);
    result.push(tile);
  }
  return result;
}
function measuredSize(tile, forbidden) {
  const value = publicText(tile.sizeLabel, "", forbidden);
  return /\d(?:[\d.,]*\d)?\s*(?:km|kilomet(?:er|re)s?|m|met(?:er|re)s?)\b/i.test(value) ? value : "";
}
function borderPoints(a, b) {
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2, by = b.y + b.h / 2;
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0)
    return null;
  const t1 = Math.min(dx ? a.w / (2 * Math.abs(dx)) : Infinity, dy ? a.h / (2 * Math.abs(dy)) : Infinity);
  const t2 = Math.min(dx ? b.w / (2 * Math.abs(dx)) : Infinity, dy ? b.h / (2 * Math.abs(dy)) : Infinity);
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t1 + t2 > 1 + Number.EPSILON)
    return null;
  return [ax + dx * t1, ay + dy * t1, bx - dx * t2, by - dy * t2];
}
function tileClass(tile) {
  if (/rumou?red/i.test(text(tile.status)))
    return "lrs-tile-rumored";
  if (/terrain|forest|river|sea|lake|mountain|wilderness/i.test(text(tile.kind)))
    return "lrs-tile-terrain";
  if (/settlement|city|kingdom|region|capital/i.test(text(tile.kind)))
    return "lrs-tile-settlement";
  if (/ruin|dungeon|fort|danger/i.test(text(tile.kind)))
    return "lrs-tile-danger";
  return "lrs-tile-place";
}
function mapName(scale) {
  return scale === "local" ? "Local" : scale === "region" ? "Region" : "World";
}
function appendField(parent, key, value) {
  const row = element("div", "lrs-detail-row");
  row.append(element("dt", undefined, key), element("dd", undefined, value));
  parent.append(row);
}
function renderMap(container, app, serial) {
  container.replaceChildren();
  const map = app.state?.maps?.[app.scale];
  if (!map) {
    container.append(element("p", "lrs-empty", app.activeChatId ? "No map snapshot yet. Enable this chat and analyze when you are ready." : "Open a chat to see its map."));
    return;
  }
  const forbidden = privateNames(app.state);
  const tiles = visibleTiles(map);
  const byId = new Map(tiles.map((tile) => [tile.id, tile]));
  if (app.selectedTileId && !byId.has(app.selectedTileId))
    app.selectedTileId = null;
  const names = new Map(tiles.map((tile) => [tile.id, publicText(tile.name, "Unnamed place", forbidden)]));
  const title = element("div", "lrs-map-heading");
  title.append(element("h3", undefined, publicText(map.name, `${mapName(app.scale)} map`, forbidden)), element("span", "lrs-small", `${tiles.length} visible ${tiles.length === 1 ? "place" : "places"}`));
  container.append(title);
  const currentTile = map.currentTileId ? byId.get(map.currentTileId) : undefined;
  if (currentTile)
    container.append(element("p", "lrs-current", `Current location: ${names.get(currentTile.id) ?? "Unnamed place"}`));
  if (!tiles.length) {
    container.append(element("p", "lrs-empty", "No revealed places are recorded at this scale yet."));
    return;
  }
  const frame = element("div", "lrs-map-frame");
  const svg = svgElement("svg");
  svg.setAttribute("viewBox", "-52 -52 104 104");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", `${mapName(app.scale)} map. Select a visible place for details. Lines indicate connections, not measured routes.`);
  const grid = svgElement("path");
  grid.setAttribute("d", "M-50 -25H50M-50 0H50M-50 25H50M-25 -50V50M0 -50V50M25 -50V50");
  grid.setAttribute("class", "lrs-grid");
  grid.setAttribute("aria-hidden", "true");
  svg.append(grid);
  const neighbors = new Map(tiles.map((tile) => [tile.id, new Set]));
  const drawn = new Set;
  let overlappingLinks = false;
  for (const tile of tiles) {
    const links = Array.isArray(tile.connections) ? tile.connections : [];
    for (const targetId of links) {
      const target = byId.get(targetId);
      if (!target || target.id === tile.id)
        continue;
      const pair = [tile.id, target.id].sort();
      const key = JSON.stringify(pair);
      if (drawn.has(key))
        continue;
      drawn.add(key);
      neighbors.get(tile.id)?.add(target.id);
      neighbors.get(target.id)?.add(tile.id);
      const points = borderPoints(tile, target);
      if (!points) {
        overlappingLinks = true;
        continue;
      }
      const line = svgElement("line");
      line.setAttribute("x1", String(points[0]));
      line.setAttribute("y1", String(points[1]));
      line.setAttribute("x2", String(points[2]));
      line.setAttribute("y2", String(points[3]));
      line.setAttribute("class", "lrs-connection-line");
      line.setAttribute("aria-hidden", "true");
      svg.append(line);
    }
  }
  const details = element("section", "lrs-detail");
  details.setAttribute("aria-label", "Selected location details");
  const list = element("div", "lrs-place-list");
  list.setAttribute("aria-label", "Visible places");
  const groups = new Map;
  const buttons = new Map;
  const updateSelection = () => {
    details.replaceChildren();
    details.append(element("h4", undefined, "Location details"));
    const selected = app.selectedTileId ? byId.get(app.selectedTileId) : undefined;
    for (const [id, group] of groups) {
      const pressed = id === selected?.id;
      group.classList.toggle("is-selected", pressed);
      group.setAttribute("aria-pressed", String(pressed));
    }
    for (const [id, button] of buttons) {
      const pressed = id === selected?.id;
      button.classList.toggle("is-selected", pressed);
      button.setAttribute("aria-pressed", String(pressed));
    }
    if (!selected) {
      details.append(element("p", "lrs-detail-hint", "Select a place on the map or from the list to see its recorded details."));
      return;
    }
    const name = names.get(selected.id) ?? "Unnamed place";
    details.append(element("h5", undefined, name));
    const fields = element("dl", "lrs-detail-fields");
    appendField(fields, "Status", publicText(selected.status, "Not recorded", forbidden));
    appendField(fields, "Type", publicText(selected.kind, "Not recorded", forbidden).replace(/[_-]+/g, " "));
    appendField(fields, "Size", measuredSize(selected, forbidden) || "Not stated in m or km");
    appendField(fields, "Summary", publicText(selected.summary, "No summary recorded.", forbidden));
    const linked = Array.from(neighbors.get(selected.id) ?? []).map((id) => names.get(id) ?? "Unnamed place");
    appendField(fields, "Connections", linked.length ? linked.join(", ") : "No visible connections recorded.");
    details.append(fields);
  };
  const defs = svgElement("defs");
  svg.append(defs);
  tiles.forEach((tile, index) => {
    const name = names.get(tile.id) ?? "Unnamed place";
    const isCurrent = tile.id === map.currentTileId;
    const group = svgElement("g");
    group.setAttribute("class", `lrs-tile ${tileClass(tile)}${isCurrent ? " is-current" : ""}`);
    group.setAttribute("tabindex", "0");
    group.setAttribute("role", "button");
    group.setAttribute("aria-label", `${name}${isCurrent ? ", current location" : ""}. Select for details.`);
    group.setAttribute("aria-pressed", "false");
    const rect = svgElement("rect");
    rect.setAttribute("x", String(tile.x));
    rect.setAttribute("y", String(tile.y));
    rect.setAttribute("width", String(tile.w));
    rect.setAttribute("height", String(tile.h));
    rect.setAttribute("rx", String(Math.min(1.2, tile.w / 8, tile.h / 8)));
    group.append(rect);
    const clipId = `lrs-clip-${serial}-${index}`;
    const clip = svgElement("clipPath");
    clip.setAttribute("id", clipId);
    const clipRect = svgElement("rect");
    clipRect.setAttribute("x", String(tile.x));
    clipRect.setAttribute("y", String(tile.y));
    clipRect.setAttribute("width", String(tile.w));
    clipRect.setAttribute("height", String(tile.h));
    clip.append(clipRect);
    defs.append(clip);
    const labels = svgElement("g");
    labels.setAttribute("clip-path", `url(#${clipId})`);
    labels.setAttribute("aria-hidden", "true");
    const size = measuredSize(tile, forbidden);
    const showSize = !!size && tile.w >= 6 && tile.h >= 4;
    const fontSize = Math.min(2.8, tile.w * 0.88 / (Math.max(name.length, 2) * 0.65), tile.h * (showSize ? 0.3 : 0.45));
    const label = svgElement("text");
    label.setAttribute("x", String(tile.x + tile.w / 2));
    label.setAttribute("y", String(tile.y + tile.h / 2 - (showSize ? fontSize * 0.45 : 0)));
    label.setAttribute("font-size", String(fontSize));
    label.setAttribute("class", "lrs-tile-label");
    label.textContent = name;
    labels.append(label);
    if (showSize) {
      const sizeText = svgElement("text");
      sizeText.setAttribute("x", String(tile.x + tile.w / 2));
      sizeText.setAttribute("y", String(tile.y + tile.h / 2 + fontSize * 0.75));
      sizeText.setAttribute("font-size", String(Math.min(fontSize * 0.72, tile.w * 0.86 / (Math.max(size.length, 2) * 0.65))));
      sizeText.setAttribute("class", "lrs-tile-label");
      sizeText.textContent = size;
      labels.append(sizeText);
    }
    group.append(labels);
    const choose = () => {
      app.selectedTileId = tile.id;
      updateSelection();
    };
    group.addEventListener("click", choose);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        choose();
      }
    });
    groups.set(tile.id, group);
    svg.append(group);
    const button = element("button", "lrs-place-button", `${name}${isCurrent ? " · current" : ""}`);
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", choose);
    buttons.set(tile.id, button);
    list.append(button);
  });
  frame.append(svg);
  container.append(frame, element("p", "lrs-map-note", "Schematic positions and connections only. Lines are not measured routes or road geometry."));
  if (overlappingLinks)
    container.append(element("p", "lrs-map-note", "Some connected places overlap, so their connection is listed in the details rather than drawn."));
  container.append(element("h4", "lrs-place-heading", "Visible places"), list, details);
  updateSelection();
}
function renderList(parent, title, values, revealed, forbidden) {
  const section = element("section", "lrs-ledger-section");
  section.append(element("h4", undefined, title));
  const entries = revealed && Array.isArray(values) ? values : [];
  if (!entries.length)
    section.append(element("p", "lrs-empty-line", revealed ? "Nothing recorded." : "Not recorded while inactive."));
  for (const entry of entries) {
    if (!entry || typeof entry !== "object")
      continue;
    const row = element("div", "lrs-ledger-row");
    const name = publicText(entry.name, "Unnamed entry", forbidden);
    const value = publicText(entry.value, "", forbidden);
    const status = publicText(entry.status, "", forbidden);
    row.append(element("strong", undefined, name), element("span", undefined, [value, status].filter(Boolean).join(" · ") || "Not recorded"));
    section.append(row);
  }
  parent.append(section);
}
function renderLedger(container, app) {
  container.replaceChildren();
  const ledger = app.state?.ledger;
  if (!ledger) {
    container.append(element("p", "lrs-empty", app.activeChatId ? "No Ledger snapshot yet." : "Open a chat to see its Ledger."));
    return;
  }
  const forbidden = privateNames(app.state);
  const revealed = text(ledger.activation).toUpperCase() === "REVEALED";
  const dormant = text(ledger.activation).toUpperCase() === "DORMANT";
  const heading = element("div", "lrs-ledger-heading");
  heading.append(element("span", `lrs-badge${revealed ? " is-revealed" : ""}`, revealed ? "Revealed" : dormant ? "Dormant" : "Not established"));
  container.append(heading);
  if (!revealed)
    container.append(element("p", "lrs-ledger-explanation", dormant ? "The Ledger is dormant: an on-screen activation has not been recorded. Values are not inferred before activation." : "Ledger activation has not been established. Values are not inferred."));
  const summary = element("div", "lrs-summary");
  for (const [label, raw] of [["Level", ledger.level], ["Experience", ledger.experience], ["Currency", ledger.currency]]) {
    const cell = element("div", "lrs-summary-cell");
    cell.append(element("span", undefined, label), element("strong", undefined, revealed ? publicText(raw, "Not recorded", forbidden) : "Not recorded"));
    summary.append(cell);
  }
  container.append(summary);
  renderList(container, "Stats", ledger.stats, revealed, forbidden);
  renderList(container, "Skills", ledger.skills, revealed, forbidden);
  renderList(container, "Equipment", ledger.equipment, revealed, forbidden);
  renderList(container, "Quests", ledger.quests, revealed, forbidden);
  renderList(container, "Flags", ledger.flags, revealed, forbidden);
  const changes = revealed && Array.isArray(ledger.recentChanges) ? ledger.recentChanges.map((value) => ({ name: publicText(value, "Unspecified change", forbidden) })) : [];
  renderList(container, "Recent changes", changes, revealed, forbidden);
  const date = app.state?.updatedAt ? new Date(app.state.updatedAt) : null;
  const updated = date && Number.isFinite(date.getTime()) && app.state?.analyzedMessageId ? `Last analyzed: ${date.toLocaleString()}` : "No analysis completed yet.";
  container.append(element("p", "lrs-small lrs-updated", updated));
}
function connectionLabel(profile) {
  return [text(profile.name, profile.id), text(profile.model), text(profile.provider)].filter(Boolean).join(" · ");
}
function renderControls(app) {
  const view = app.view;
  const pending = app.pending;
  const active = !!app.activeChatId;
  const locked = !app.chatSynced || app.initializing || !!pending;
  const desiredEnabled = pending?.kind === "enabled" ? pending.desired === true : app.config.enabled;
  const selectedId = pending?.kind === "connection" ? pending.desired : app.config.connectionId;
  view.enabled.checked = desiredEnabled;
  view.enabled.disabled = !active || locked;
  view.connection.replaceChildren();
  const placeholder = element("option", undefined, app.connections.length ? "Choose a connection" : "No saved connections available");
  placeholder.value = "";
  view.connection.append(placeholder);
  for (const profile of app.connections) {
    const option = element("option", undefined, connectionLabel(profile));
    option.value = profile.id;
    view.connection.append(option);
  }
  if (selectedId && !app.connections.some((profile) => profile.id === selectedId)) {
    const unavailable = element("option", undefined, "Previously selected connection is unavailable");
    unavailable.value = selectedId;
    view.connection.append(unavailable);
  }
  view.connection.value = selectedId ?? "";
  view.connection.disabled = !active || locked;
  const availableConnection = !!app.config.connectionId && app.connections.some((profile) => profile.id === app.config.connectionId);
  const stale = !!app.state?.stale || !!app.staleNotice;
  const blocked = !active || locked || app.busy || !app.config.enabled || !availableConnection;
  view.analyze.disabled = blocked || stale;
  view.rebuild.disabled = blocked;
  view.reload.disabled = app.initializing || !!pending;
  view.chat.textContent = active ? `Active chat · ${app.activeChatId}` : app.chatKnown ? "No chat open" : "Finding the active chat…";
  const forbidden = privateNames(app.state);
  view.status.textContent = app.initializing ? "Loading the current chat’s sidecar…" : publicText(app.message, "Sidecar status updated.", forbidden);
  view.error.textContent = publicText(app.error, "", forbidden);
  view.error.hidden = !view.error.textContent;
  const reason = app.state?.stale ? publicText(app.state.staleReason, "The saved snapshot no longer matches the chat.", forbidden) : publicText(app.staleNotice, "", forbidden);
  view.stale.textContent = reason ? `Snapshot is stale. ${reason} Use Rebuild to replace it.` : "";
  view.stale.hidden = !reason;
  view.notices.replaceChildren();
  const notices = Array.isArray(app.state?.notices) ? app.state.notices : [];
  for (const notice of notices) {
    const safe = publicText(notice, "", forbidden);
    if (safe)
      view.notices.append(element("p", undefined, safe));
  }
  view.notices.hidden = !view.notices.childNodes.length;
}
function render(app, serial) {
  if (app.destroyed)
    return;
  renderControls(app);
  renderMap(app.view.map, app, serial);
  renderLedger(app.view.ledger, app);
}
function clearPending(app) {
  if (app.pending?.timer)
    clearTimeout(app.pending.timer);
  app.pending = null;
}
function clearInitTimer(app) {
  if (app.initTimer)
    clearTimeout(app.initTimer);
  app.initTimer = null;
}
function buildView(root) {
  const shell = element("div", "lrs-shell");
  const intro = element("header", "lrs-intro");
  intro.append(element("span", "lrs-eyebrow", "PRIVATE COMPANION"), element("h2", undefined, "Map & Ledger"), element("p", undefined, "A separate, display-only record of what has been revealed in this chat."));
  const privacy = element("p", "lrs-privacy", "Off by default for each chat. Enabling background updates sends recent private chat text to the selected provider after later replies. Analyze now and Rebuild may send it immediately. The provider may be external and extra charges may apply. The connection choice is shared across chats. This sidecar does not change your chat or preset, or inject its state into the roleplay prompt.");
  const settings = element("div", "lrs-settings");
  const toggleLabel = element("label", "lrs-toggle");
  const enabled = element("input");
  enabled.type = "checkbox";
  toggleLabel.append(enabled, element("span", undefined, "Enable background updates for this chat"));
  const connectionLabelEl = element("label", "lrs-control");
  connectionLabelEl.append(element("span", undefined, "Analysis connection · shared across chats"));
  const connection = element("select");
  connection.setAttribute("aria-label", "Analysis connection, shared across chats");
  connectionLabelEl.append(connection);
  const actions = element("div", "lrs-actions");
  const analyze = element("button", "lrs-primary", "Analyze now");
  const rebuild = element("button", undefined, "Rebuild snapshot");
  const reload = element("button", undefined, "Reload");
  for (const button of [analyze, rebuild, reload])
    button.type = "button";
  actions.append(analyze, rebuild, reload);
  settings.append(toggleLabel, connectionLabelEl, actions);
  const stateBox = element("div", "lrs-state-box");
  const chat = element("div", "lrs-chat");
  const status = element("div", "lrs-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const error = element("p", "lrs-error");
  error.setAttribute("role", "alert");
  const stale = element("p", "lrs-stale");
  stale.setAttribute("role", "status");
  const notices = element("div", "lrs-notices");
  stateBox.append(chat, status, error, stale, notices);
  const mapPanel = element("section", "lrs-panel");
  const mapPanelHead = element("div", "lrs-panel-head");
  const mapHeadText = element("div");
  mapHeadText.append(element("span", "lrs-eyebrow", "EXPLORE"), element("h3", undefined, "Map"));
  const scaleLabel = element("label", "lrs-scale-label");
  scaleLabel.append(element("span", undefined, "Scale"));
  const scale = element("select");
  scale.setAttribute("aria-label", "Map scale");
  for (const item of ["local", "region", "world"]) {
    const option = element("option", undefined, mapName(item));
    option.value = item;
    scale.append(option);
  }
  scale.value = "region";
  scaleLabel.append(scale);
  mapPanelHead.append(mapHeadText, scaleLabel);
  const map = element("div", "lrs-map");
  mapPanel.append(mapPanelHead, map);
  const ledgerPanel = element("section", "lrs-panel");
  const ledgerHead = element("div", "lrs-panel-head");
  const ledgerHeadText = element("div");
  ledgerHeadText.append(element("span", "lrs-eyebrow", "RECORDS"), element("h3", undefined, "The Ledger"));
  ledgerHead.append(ledgerHeadText);
  const ledger = element("div", "lrs-ledger");
  ledgerPanel.append(ledgerHead, ledger);
  shell.append(intro, privacy, settings, stateBox, mapPanel, ledgerPanel);
  root.replaceChildren(shell);
  return { root, scale, connection, enabled, analyze, rebuild, reload, chat, status, error, stale, notices, map, ledger };
}
function setup(ctx) {
  const serial = ++instanceSerial;
  const tab = ctx.ui.registerDrawerTab({ id: "rpg", title: "LumiRPG Sidecar", shortName: "RPG", headerTitle: "Map & Ledger", description: "View a separate map and Ledger for this chat", keywords: ["map", "ledger", "rpg", "sidecar"], iconSvg: icon });
  const removeStyle = ctx.dom.addStyle(`
    .lrs-shell{box-sizing:border-box;display:flex;flex-direction:column;gap:13px;padding:16px;color:var(--lumiverse-text,#eef0f7);font-family:var(--lumiverse-font,system-ui,sans-serif);font-size:13px;line-height:1.5}
    .lrs-shell *{box-sizing:border-box}.lrs-shell h2,.lrs-shell h3,.lrs-shell h4,.lrs-shell h5,.lrs-shell p{margin:0}.lrs-shell h2{font-size:21px;line-height:1.2}.lrs-intro p{margin-top:5px;color:var(--lumiverse-text-muted,#aeb4c8)}
    .lrs-eyebrow{display:block;margin-bottom:4px;color:var(--lumiverse-primary,#b3a1ff);font-size:10px;font-weight:750;letter-spacing:.14em}.lrs-privacy{padding:11px 12px;border:1px solid var(--lumiverse-border,#45485d);border-left:3px solid #d9ad65;border-radius:9px;background:var(--lumiverse-fill-subtle,#232536);font-size:12px;color:var(--lumiverse-text,#eef0f7)}
    .lrs-settings,.lrs-state-box,.lrs-panel{border:1px solid var(--lumiverse-border,#45485d);border-radius:12px;background:var(--lumiverse-fill-subtle,#232536);padding:13px}.lrs-settings{display:grid;gap:12px}.lrs-toggle{display:flex;align-items:flex-start;gap:9px;font-weight:650;cursor:pointer}.lrs-toggle input{accent-color:var(--lumiverse-primary,#a992ff);width:16px;height:16px;margin:2px 0 0;flex:none}
    .lrs-control{display:grid;gap:5px;font-size:11px;font-weight:700;color:var(--lumiverse-text-muted,#aeb4c8)}.lrs-shell select,.lrs-shell button{font:inherit;color:var(--lumiverse-text,#eef0f7);background:var(--lumiverse-fill,#292c3e);border:1px solid var(--lumiverse-border,#55586e);border-radius:8px;padding:8px 10px}.lrs-shell select{max-width:100%;width:100%}.lrs-shell button{cursor:pointer}.lrs-shell button:hover:not(:disabled){border-color:var(--lumiverse-primary,#b3a1ff)}.lrs-shell button:focus-visible,.lrs-shell select:focus-visible,.lrs-shell input:focus-visible{outline:2px solid var(--lumiverse-primary,#b3a1ff);outline-offset:2px}.lrs-shell button:disabled,.lrs-shell select:disabled,.lrs-shell input:disabled{opacity:.52;cursor:not-allowed}
    .lrs-actions{display:flex;flex-wrap:wrap;gap:7px}.lrs-actions .lrs-primary{border-color:var(--lumiverse-primary,#b3a1ff);font-weight:700}.lrs-state-box{display:grid;gap:4px}.lrs-chat{font-weight:700;overflow-wrap:anywhere}.lrs-status,.lrs-small,.lrs-notices{font-size:11px;color:var(--lumiverse-text-muted,#aeb4c8)}.lrs-error,.lrs-stale{padding:8px 10px;border-radius:7px;font-size:12px;overflow-wrap:anywhere}.lrs-error{background:rgba(196,64,73,.17);color:#ffb8b8}.lrs-stale{background:rgba(198,145,46,.16);color:#f4d39b}.lrs-error[hidden],.lrs-stale[hidden],.lrs-notices[hidden]{display:none}.lrs-notices p+p{margin-top:4px}
    .lrs-panel-head{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:12px}.lrs-panel-head h3{font-size:17px;line-height:1.2}.lrs-scale-label{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--lumiverse-text-muted,#aeb4c8)}.lrs-scale-label select{width:auto}.lrs-map-heading,.lrs-ledger-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}.lrs-map-heading h3{font-size:14px;overflow-wrap:anywhere}
    .lrs-map-frame{overflow:hidden;border:1px solid var(--lumiverse-border,#45485d);border-radius:9px;background:radial-gradient(circle at 50% 25%,rgba(126,115,198,.13),transparent 62%),var(--lumiverse-fill,#1b1d2b)}.lrs-map-frame svg{display:block;width:100%;max-width:620px;aspect-ratio:1;margin:auto}.lrs-grid{fill:none;stroke:var(--lumiverse-border,#575a70);stroke-width:.2;opacity:.45}.lrs-connection-line{stroke:#d2ae77;stroke-width:2;stroke-dasharray:5 3;vector-effect:non-scaling-stroke;stroke-linecap:round;opacity:.9}
    .lrs-tile{cursor:pointer}.lrs-tile rect{stroke:#c9d0e0;stroke-width:1;vector-effect:non-scaling-stroke}.lrs-tile-place rect{fill:#344c69}.lrs-tile-terrain rect{fill:#34574d}.lrs-tile-settlement rect{fill:#70494f}.lrs-tile-danger rect{fill:#71523b}.lrs-tile-rumored rect{fill:#574a72}.lrs-tile:hover rect,.lrs-tile:focus-visible rect,.lrs-tile.is-selected rect{stroke:#fff;stroke-width:2.5}.lrs-tile.is-current rect{stroke:#f7d58a;stroke-width:2.5}.lrs-tile.is-current.is-selected rect{stroke:#fff;stroke-width:3}.lrs-tile:focus-visible{outline:none}.lrs-tile-label{text-anchor:middle;dominant-baseline:middle;fill:#fff;paint-order:stroke;stroke:#151824;stroke-width:.2;stroke-linejoin:round;pointer-events:none}.lrs-map-note{font-size:11px;color:var(--lumiverse-text-muted,#aeb4c8);margin-top:7px!important}
    .lrs-place-heading{margin-top:12px!important;margin-bottom:6px!important;font-size:12px}.lrs-place-list{display:flex;flex-wrap:wrap;gap:6px}.lrs-place-button{font-size:11px!important;padding:5px 8px!important;overflow-wrap:anywhere}.lrs-place-button.is-selected{border-color:var(--lumiverse-primary,#b3a1ff);box-shadow:0 0 0 1px var(--lumiverse-primary,#b3a1ff)}.lrs-detail{margin-top:12px;padding:11px;background:var(--lumiverse-fill,#292c3e);border:1px solid var(--lumiverse-border,#45485d);border-radius:9px}.lrs-detail h4{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--lumiverse-text-muted,#aeb4c8)}.lrs-detail h5{font-size:15px;margin-top:5px}.lrs-detail-hint{margin-top:6px!important;font-size:12px;color:var(--lumiverse-text-muted,#aeb4c8)}.lrs-detail-fields{display:grid;gap:6px;margin:9px 0 0}.lrs-detail-row{display:grid;grid-template-columns:80px minmax(0,1fr);gap:8px}.lrs-detail-row dt{font-size:11px;color:var(--lumiverse-text-muted,#aeb4c8)}.lrs-detail-row dd{margin:0;overflow-wrap:anywhere}
    .lrs-badge{padding:4px 9px;border:1px solid var(--lumiverse-border,#55586e);border-radius:999px;font-size:11px;color:var(--lumiverse-text-muted,#aeb4c8)}.lrs-badge.is-revealed{color:#a9e3bc;border-color:#699c7b}.lrs-ledger-explanation{font-size:12px;color:var(--lumiverse-text-muted,#aeb4c8);margin-bottom:10px!important}.lrs-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(95px,1fr));gap:7px}.lrs-summary-cell{min-width:0;padding:8px;background:var(--lumiverse-fill,#292c3e);border:1px solid var(--lumiverse-border,#45485d);border-radius:8px}.lrs-summary-cell span{display:block;font-size:10px;color:var(--lumiverse-text-muted,#aeb4c8);text-transform:uppercase;letter-spacing:.06em}.lrs-summary-cell strong{display:block;overflow-wrap:anywhere}.lrs-ledger-section{margin-top:13px}.lrs-ledger-section h4{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--lumiverse-text-muted,#aeb4c8)}.lrs-ledger-row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--lumiverse-border,#45485d);overflow-wrap:anywhere}.lrs-ledger-row span{text-align:right;color:var(--lumiverse-text-muted,#aeb4c8)}.lrs-empty,.lrs-empty-line{padding:10px 0;color:var(--lumiverse-text-muted,#aeb4c8);font-size:12px}.lrs-updated{margin-top:12px!important}
    @media(max-width:480px){.lrs-shell{padding:11px}.lrs-panel,.lrs-settings,.lrs-state-box{padding:11px}.lrs-ledger-row{flex-direction:column;gap:2px}.lrs-ledger-row span{text-align:left}.lrs-detail-row{grid-template-columns:1fr;gap:1px}}
  `);
  const view = buildView(tab.root);
  const app = { view, state: null, config: { enabled: false, connectionId: null }, connections: [], activeChatId: null, chatKnown: false, chatSynced: false, initializing: false, initTimer: null, requestId: "", expectedChatId: null, expectedChatKnown: false, refreshAfterInit: false, statusDuringInit: false, stateDuringInit: false, pending: null, busy: false, staleNotice: "", message: "Waiting for the sidecar.", error: "", scale: "region", selectedTileId: null, destroyed: false };
  let sequence = 0;
  let earlyStatuses = [];
  const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const listeners = [];
  const listen = (node, type, handler) => {
    node.addEventListener(type, handler);
    listeners.push(() => node.removeEventListener(type, handler));
  };
  const send = (payload) => {
    try {
      ctx.sendToBackend(payload);
      return true;
    } catch {
      app.busy = false;
      app.error = "Could not reach the sidecar backend. Please reload the panel.";
      render(app, serial);
      return false;
    }
  };
  const requestInit = () => {
    if (app.destroyed)
      return;
    clearInitTimer(app);
    earlyStatuses = [];
    app.requestId = `${session}-${++sequence}`;
    app.expectedChatId = app.activeChatId;
    app.expectedChatKnown = app.chatKnown;
    app.initializing = true;
    app.refreshAfterInit = false;
    app.statusDuringInit = false;
    app.stateDuringInit = false;
    const requestId = app.requestId;
    app.initTimer = setTimeout(() => {
      if (app.destroyed || !app.initializing || app.requestId !== requestId)
        return;
      app.initTimer = null;
      earlyStatuses = [];
      app.initializing = false;
      app.chatSynced = false;
      clearPending(app);
      app.error = "The sidecar did not finish loading. Reload the panel to try again.";
      render(app, serial);
    }, 15000);
    render(app, serial);
    if (!send({ type: "init", requestId })) {
      clearInitTimer(app);
      earlyStatuses = [];
      app.initializing = false;
      app.chatSynced = false;
      clearPending(app);
      render(app, serial);
    }
  };
  const startPending = (kind, desired, chatId) => {
    clearPending(app);
    const pending = { kind, desired, chatId, timer: null };
    app.pending = pending;
    app.error = "";
    pending.timer = setTimeout(() => {
      if (app.destroyed || app.pending !== pending)
        return;
      clearPending(app);
      app.error = "The settings change could not be confirmed. Reloading the saved settings.";
      requestInit();
    }, 15000);
    render(app, serial);
  };
  listen(view.scale, "change", () => {
    const scale = view.scale.value;
    if (scale !== "local" && scale !== "region" && scale !== "world")
      return;
    app.scale = scale;
    app.selectedTileId = null;
    render(app, serial);
  });
  listen(view.enabled, "change", () => {
    const chatId = app.activeChatId;
    if (!chatId || !app.chatSynced || app.initializing || app.pending) {
      render(app, serial);
      return;
    }
    const enabled = view.enabled.checked;
    startPending("enabled", enabled, chatId);
    if (!enabled) {
      app.busy = false;
      app.message = "Pausing background updates…";
    }
    if (!send({ type: "set_enabled", chatId, enabled })) {
      clearPending(app);
      render(app, serial);
    }
  });
  listen(view.connection, "change", () => {
    const chatId = app.activeChatId;
    if (!chatId || !app.chatSynced || app.initializing || app.pending) {
      render(app, serial);
      return;
    }
    const connectionId = view.connection.value || null;
    if (connectionId && !app.connections.some((item) => item.id === connectionId)) {
      render(app, serial);
      return;
    }
    startPending("connection", connectionId, chatId);
    app.busy = false;
    app.message = "Saving the analysis connection…";
    if (!send({ type: "set_connection", chatId, connectionId })) {
      clearPending(app);
      render(app, serial);
    }
  });
  listen(view.analyze, "click", () => {
    const chatId = app.activeChatId;
    if (!chatId || view.analyze.disabled)
      return;
    app.error = "";
    app.busy = true;
    app.message = "Requesting analysis of recent visible messages…";
    render(app, serial);
    send({ type: "analyze_now", chatId });
  });
  listen(view.rebuild, "click", () => {
    const chatId = app.activeChatId;
    if (!chatId || view.rebuild.disabled)
      return;
    (async () => {
      try {
        const result = await ctx.ui.showConfirm({ title: "Rebuild sidecar snapshot?", message: "This replaces the current map and Ledger snapshot using only the recent visible message window, so older tracked details may be lost. Recent private chat text will be sent to the selected provider and additional charges may apply. Your chat and preset will not be changed.", variant: "warning", confirmLabel: "Rebuild snapshot", cancelLabel: "Cancel" });
        if (!result?.confirmed || app.destroyed || app.activeChatId !== chatId || view.rebuild.disabled)
          return;
        app.error = "";
        app.busy = true;
        app.message = "Requesting a snapshot rebuild…";
        render(app, serial);
        send({ type: "rebuild", chatId });
      } catch {
        if (app.destroyed || app.activeChatId !== chatId)
          return;
        app.error = "Could not open the rebuild confirmation. No rebuild was requested.";
        render(app, serial);
      }
    })();
  });
  listen(view.reload, "click", () => {
    if (app.initializing || app.pending)
      return;
    app.error = "";
    app.busy = false;
    requestInit();
  });
  const unsubChat = ctx.events.on("CHAT_SWITCHED", (payload) => {
    clearPending(app);
    app.activeChatId = typeof payload?.chatId === "string" && payload.chatId ? payload.chatId : null;
    app.chatKnown = true;
    app.chatSynced = false;
    app.state = null;
    app.config = { enabled: false, connectionId: null };
    app.connections = [];
    app.selectedTileId = null;
    app.busy = false;
    app.staleNotice = "";
    app.error = "";
    app.message = app.activeChatId ? "Loading the selected chat." : "Open a chat to begin.";
    requestInit();
  });
  const handleBackend = (payload) => {
    if (app.destroyed || !payload || typeof payload !== "object")
      return;
    if (payload.type === "init") {
      if (!app.initializing || payload.requestId !== app.requestId)
        return;
      clearInitTimer(app);
      const incomingChat = typeof payload.activeChatId === "string" && payload.activeChatId ? payload.activeChatId : null;
      if (app.expectedChatKnown && incomingChat !== app.expectedChatId) {
        app.initializing = false;
        app.chatSynced = false;
        app.state = null;
        app.config = { enabled: false, connectionId: null };
        app.connections = [];
        app.selectedTileId = null;
        app.busy = false;
        app.staleNotice = "";
        clearPending(app);
        app.error = "The active chat changed while loading. Reload the panel for the current chat.";
        render(app, serial);
        return;
      }
      app.activeChatId = incomingChat;
      app.chatKnown = true;
      app.chatSynced = true;
      const queuedStatuses = earlyStatuses;
      earlyStatuses = [];
      for (const status of queuedStatuses)
        handleBackend(status);
      const previousState = app.state;
      app.config = { enabled: incomingChat && payload.config?.enabled === true ? true : false, connectionId: typeof payload.config?.connectionId === "string" && payload.config.connectionId ? payload.config.connectionId : null };
      app.connections = Array.isArray(payload.connections) ? payload.connections.filter((item) => item && typeof item.id === "string" && !!item.id).map((item) => ({ id: item.id, name: text(item.name, item.id), model: text(item.model), provider: text(item.provider) })) : [];
      if (payload.state === null || payload.state === undefined)
        app.state = null;
      else if (incomingChat && payload.state.version === 1 && payload.state.chatId === incomingChat)
        app.state = payload.state;
      else {
        app.state = null;
        app.error = "The sidecar returned a snapshot for a different chat or an unsupported version.";
      }
      const previousTime = previousState ? Date.parse(previousState.updatedAt) : NaN;
      const newTime = app.state ? Date.parse(app.state.updatedAt) : NaN;
      if (previousState?.chatId === incomingChat) {
        if (app.state && Number.isFinite(previousTime) && Number.isFinite(newTime) && previousTime > newTime)
          app.state = previousState;
        else if (app.stateDuringInit && (!app.state || !Number.isFinite(previousTime) || !Number.isFinite(newTime) || previousTime >= newTime))
          app.state = previousState;
      }
      if (app.state?.stale)
        app.staleNotice = text(app.state.staleReason, "The snapshot no longer matches the chat.");
      else if (!app.statusDuringInit)
        app.staleNotice = "";
      if (app.pending && app.pending.chatId === incomingChat) {
        const applied = app.pending.kind === "enabled" ? app.config.enabled === app.pending.desired : app.config.connectionId === app.pending.desired;
        if (applied)
          clearPending(app);
      }
      app.initializing = false;
      if (!incomingChat)
        app.message = "Open a chat to begin.";
      else if (!app.statusDuringInit && !app.busy)
        app.message = app.state?.analyzedMessageId ? "Snapshot loaded from the last analysis." : "No analysis completed yet.";
      const refresh = app.refreshAfterInit;
      app.refreshAfterInit = false;
      render(app, serial);
      if (refresh)
        requestInit();
      return;
    }
    if (payload.type !== "status" || !["updating", "ready", "error", "stale"].includes(payload.status))
      return;
    if (app.initializing && !app.chatKnown) {
      if (typeof payload.chatId !== "string" && payload.chatId !== null)
        return;
      earlyStatuses.push(payload);
      if (earlyStatuses.length > 32)
        earlyStatuses.shift();
      return;
    }
    const sameChat = app.activeChatId ? payload.chatId === app.activeChatId : app.chatKnown && (payload.chatId === "" || payload.chatId === null);
    if (!sameChat || !app.chatSynced && !app.initializing)
      return;
    const message = text(payload.message, "Sidecar status changed.");
    if (payload.state) {
      if (payload.state.version !== 1 || payload.state.chatId !== app.activeChatId)
        return;
      const currentTime = app.state ? Date.parse(app.state.updatedAt) : NaN;
      const incomingTime = Date.parse(payload.state.updatedAt);
      if (!Number.isFinite(currentTime) || !Number.isFinite(incomingTime) || incomingTime >= currentTime) {
        app.state = payload.state;
        if (app.initializing)
          app.stateDuringInit = true;
        if (app.state.stale)
          app.staleNotice = text(app.state.staleReason, message);
        else if (payload.status === "ready")
          app.staleNotice = "";
      }
    }
    if (app.initializing) {
      app.statusDuringInit = true;
      if (payload.state || payload.status === "stale" || app.pending && payload.status === "ready")
        app.refreshAfterInit = true;
    }
    app.message = message;
    app.busy = payload.status === "updating";
    if (payload.status === "error")
      app.error = message;
    else if (payload.status === "updating")
      app.error = "";
    if (payload.status === "stale")
      app.staleNotice = message;
    const checkSettings = !!app.pending && (payload.status === "ready" || payload.status === "error");
    if (payload.status === "error" && app.pending)
      clearPending(app);
    render(app, serial);
    if (checkSettings && !app.initializing)
      requestInit();
  };
  const unsubBackend = ctx.onBackendMessage(handleBackend);
  render(app, serial);
  requestInit();
  return () => {
    app.destroyed = true;
    earlyStatuses = [];
    clearInitTimer(app);
    clearPending(app);
    for (const off of listeners)
      off();
    unsubChat();
    unsubBackend();
    removeStyle();
    tab.destroy();
  };
}
export {
  setup
};
