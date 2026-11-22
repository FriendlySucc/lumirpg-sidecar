import {
  computeViewBox,
  connectorSegment,
  defaultPinColor,
  defaultTileColor,
  findSharedEdge,
} from './geometry.js'
import type {
  AtlasState,
  BackendToFrontendMessage,
  ConnectionOption,
  EffectiveConfig,
  FrontendToBackendMessage,
  MapLayer,
  Scale,
  Tile,
} from './types.js'
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

const SVG_NS = 'http://www.w3.org/2000/svg'

const ATLAS_ICON_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8Zm4.2-12.2-6.1 2.4-2.3 6 6.1-2.4 2.3-6Zm-4.2 5.4a1.2 1.2 0 1 1 1.2-1.2 1.2 1.2 0 0 1-1.2 1.2Z"/></svg>'

const STYLES = `
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
.la-scale-tabs {
  display: inline-flex;
  border: 1px solid var(--lumiverse-border, #3e4359);
  border-radius: 8px;
  overflow: hidden;
  background: #191c29;
}
.la-scale-tab {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--lumiverse-text-muted, #aeb4c8);
  padding: 5px 11px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.la-scale-tab[aria-selected="true"] {
  background: var(--lumiverse-primary, #7c6cf6);
  color: #fff;
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
.la-layer-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.la-layer-bar[hidden] { display: none; }
.la-layer-bar-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--lumiverse-text-muted, #aeb4c8);
  white-space: nowrap;
}
.la-layer-select {
  flex: 1 1 160px;
  min-width: 140px;
  padding: 5px 8px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, #3e4359);
  background: #171926;
  color: var(--lumiverse-text, #eef0f7);
  font: inherit;
  font-size: 12px;
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
`

interface Camera {
  x: number
  y: number
  w: number
  h: number
}

interface StreamPreview {
  phase: 'thinking' | 'writing'
  reasoning: string
  outputChars: number
  outputTail: string
}

interface AppState {
  activeChatId: string | null
  config: EffectiveConfig
  connections: ConnectionOption[]
  atlas: AtlasState | null
  archives: Record<Scale, MapLayer[]>
  selectedLayerId: Record<Scale, string | null>
  scale: Scale
  floor: number
  selectedTileId: string | null
  busy: boolean
  stream: StreamPreview | null
  thinkingOpen: boolean
  statusMessage: string
  error: string | null
  settingsOpen: boolean
  showPins: boolean
  showRoads: boolean
  showLabels: boolean
  camera: Camera
  cameraScaleKey: string
  destroyed: boolean
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      node.setAttribute(k, String(v))
    }
  }
  return node
}

function makeRequestId(ctx: SpindleFrontendContext, fallbackCounter: number): string {
  if (ctx.uuid && (ctx.host.capabilities['frontend-uuid-v1'] ?? 0) >= 1) {
    return ctx.uuid.v4()
  }
  return `la_req_${Date.now()}_${fallbackCounter}`
}

function getVisibleTiles(layer: MapLayer, floor: number): Tile[] {
  if (layer.scale !== 'local') return layer.tiles
  return layer.tiles.filter((t) => t.floor === floor)
}

function getFloors(layer: MapLayer): number[] {
  if (layer.scale !== 'local') return [0]
  const floors = Array.from(new Set(layer.tiles.map((t) => t.floor))).sort((a, b) => a - b)
  return floors.length ? floors : [0]
}

export function setup(ctx: SpindleFrontendContext) {
  let reqCounter = 0
  let pendingRequestId: string | null = null
  const cleanups: Array<() => void> = []

  const tab = ctx.ui.registerDrawerTab({
    id: 'atlas',
    title: 'LumiAtlas',
    shortName: 'Atlas',
    headerTitle: 'Atlas Map',
    description: '3-layer background cartographic map (Local, Region, World)',
    keywords: ['map', 'atlas', 'world', 'region', 'local', 'pins'],
    iconSvg: ATLAS_ICON_SVG,
  })

  const removeStyle = ctx.dom.addStyle(STYLES)

  const state: AppState = {
    activeChatId: ctx.getActiveChat().chatId,
    config: { enabled: false, autoUpdate: true, connectionId: null, reasoningMode: 'inherit' },
    connections: [],
    atlas: null,
    archives: { local: [], region: [], world: [] },
    selectedLayerId: { local: null, region: null, world: null },
    scale: 'local',
    floor: 0,
    selectedTileId: null,
    busy: false,
    stream: null,
    thinkingOpen: true,
    statusMessage: 'Loading Atlas…',
    error: null,
    settingsOpen: false,
    showPins: true,
    showRoads: true,
    showLabels: true,
    camera: { x: -50, y: -50, w: 100, h: 100 },
    cameraScaleKey: '',
    destroyed: false,
  }

  // Build static DOM skeleton
  const root = el('div', 'la-root')

  // Header
  const header = el('div', 'la-header')
  const titleGroup = el('div', 'la-title-group')
  const locationEl = el('div', 'la-location', 'LumiAtlas')
  const subtitleEl = el('div', 'la-subtitle', 'Loading…')
  titleGroup.append(locationEl, subtitleEl)

  const actions = el('div', 'la-actions')
  const analyzeBtn = el('button', 'la-btn la-btn-primary', 'Analyze')
  const rebuildBtn = el('button', 'la-btn', 'Rebuild')
  const cancelBtn = el('button', 'la-btn la-btn-danger', 'Cancel')
  cancelBtn.hidden = true
  const settingsBtn = el('button', 'la-btn', 'Settings')
  actions.append(analyzeBtn, rebuildBtn, cancelBtn, settingsBtn)
  header.append(titleGroup, actions)

  // Settings panel
  const settingsBox = el('div', 'la-settings')
  settingsBox.hidden = true

  const connField = el('label', 'la-field', 'Background Map Model (Connection)')
  const connSelect = el('select', 'la-select')
  connField.append(connSelect)

  const toggles = el('div', 'la-toggles')
  const enabledLabel = el('label', 'la-check')
  const enabledInput = el('input')
  enabledInput.type = 'checkbox'
  enabledLabel.append(enabledInput, document.createTextNode('Enable for this chat'))

  const autoLabel = el('label', 'la-check')
  const autoInput = el('input')
  autoInput.type = 'checkbox'
  autoLabel.append(autoInput, document.createTextNode('Auto-update after replies'))

  const reasoningLabel = el('label', 'la-check')
  const reasoningInput = el('input')
  reasoningInput.type = 'checkbox'
  reasoningLabel.append(reasoningInput, document.createTextNode('Show model thinking'))

  const refreshBtn = el('button', 'la-btn', 'Reload')
  toggles.append(enabledLabel, autoLabel, reasoningLabel, refreshBtn)
  settingsBox.append(connField, toggles)

  // Banners
  const errorBanner = el('div', 'la-banner la-banner-error')
  errorBanner.hidden = true
  const staleBanner = el('div', 'la-banner la-banner-stale')
  staleBanner.hidden = true

  // Live thinking / generation stream panel
  const thinkingBox = el('div', 'la-thinking')
  thinkingBox.hidden = true
  const thinkingHead = el('div', 'la-thinking-head')
  const thinkingTitle = el('div', 'la-thinking-title')
  const thinkingDot = el('span', 'la-thinking-dot la-pulse')
  const thinkingLabel = el('span', undefined, 'Model thinking…')
  thinkingTitle.append(thinkingDot, thinkingLabel)
  const thinkingMeta = el('span', 'la-thinking-meta', '')
  thinkingHead.append(thinkingTitle, thinkingMeta)
  const thinkingBody = el('pre', 'la-thinking-body', '')
  thinkingBox.append(thinkingHead, thinkingBody)

  // Scale & view toolbar
  const toolbar = el('div', 'la-toolbar')
  const scaleTabs = el('div', 'la-scale-tabs')
  scaleTabs.setAttribute('role', 'tablist')
  const scaleButtons: Record<Scale, HTMLButtonElement> = {
    local: el('button', 'la-scale-tab', 'Local'),
    region: el('button', 'la-scale-tab', 'Region'),
    world: el('button', 'la-scale-tab', 'World'),
  }
  for (const s of ['local', 'region', 'world'] as Scale[]) {
    scaleButtons[s].type = 'button'
    scaleButtons[s].setAttribute('role', 'tab')
    scaleTabs.append(scaleButtons[s])
  }

  const layerTools = el('div', 'la-layer-tools')
  const floorBar = el('div', 'la-floors')
  const pinsToggle = el('button', 'la-btn la-btn-active', 'Pins')
  const roadsToggle = el('button', 'la-btn la-btn-active', 'Roads')
  const labelsToggle = el('button', 'la-btn la-btn-active', 'Labels')
  layerTools.append(floorBar, pinsToggle, roadsToggle, labelsToggle)
  toolbar.append(scaleTabs, layerTools)

  // Local / Region tileset selector bar
  const layerBar = el('div', 'la-layer-bar')
  layerBar.hidden = true
  const layerBarLabel = el('span', 'la-layer-bar-label', 'Zone')
  const layerSelect = el('select', 'la-layer-select')
  layerSelect.setAttribute('aria-label', 'Select generated map tileset')
  layerBar.append(layerBarLabel, layerSelect)

  // Map canvas
  const canvasWrap = el('div', 'la-canvas-wrap')
  const svg = svgEl('svg', {
    class: 'la-svg',
    viewBox: '-50 -50 100 100',
    preserveAspectRatio: 'xMidYMid meet',
  })
  const hudBadge = el('div', 'la-hud-badge', 'Local')
  const hudCorner = el('div', 'la-hud-corner')
  const zoomInBtn = el('button', 'la-btn la-btn-icon', '+')
  zoomInBtn.title = 'Zoom in'
  const zoomOutBtn = el('button', 'la-btn la-btn-icon', '−')
  zoomOutBtn.title = 'Zoom out'
  const fitBtn = el('button', 'la-btn la-btn-icon', 'Fit')
  fitBtn.title = 'Fit map to view'
  hudCorner.append(zoomOutBtn, zoomInBtn, fitBtn)

  const emptyOverlay = el('div', 'la-empty-overlay')
  canvasWrap.append(svg, hudBadge, hudCorner, emptyOverlay)

  // Inspector
  const inspector = el('div', 'la-inspector')

  root.append(header, settingsBox, errorBanner, staleBanner, thinkingBox, toolbar, layerBar, canvasWrap, inspector)
  tab.root.replaceChildren(root)

  function send(msg: FrontendToBackendMessage): void {
    if (state.destroyed) return
    ctx.sendToBackend(msg)
  }

  function requestInit(): void {
    const reqId = makeRequestId(ctx, ++reqCounter)
    pendingRequestId = reqId
    const active = ctx.getActiveChat()
    state.activeChatId = active.chatId
    send({ type: 'init', requestId: reqId, chatId: active.chatId })
  }

  function availableLayers(scale: Scale): MapLayer[] {
    const result: MapLayer[] = []
    const seen = new Set<string>()
    const active = state.atlas?.maps?.[scale]
    if (active && active.tiles.length > 0) {
      result.push(active)
      seen.add(active.id)
    }
    for (const archived of state.archives[scale] ?? []) {
      if (archived && archived.tiles.length > 0 && !seen.has(archived.id)) {
        result.push(archived)
        seen.add(archived.id)
      }
    }
    return result
  }

  function currentLayer(): MapLayer | null {
    const active = state.atlas?.maps?.[state.scale] ?? null
    const pickedId = state.selectedLayerId[state.scale]
    if (pickedId) {
      const list = availableLayers(state.scale)
      const match = list.find((l) => l.id === pickedId)
      if (match) return match
    }
    return active
  }

  function fitCamera(force = false): void {
    const layer = currentLayer()
    const key = `${state.activeChatId ?? ''}:${state.scale}:${state.floor}:${layer?.id ?? ''}:${layer?.tiles.length ?? 0}`
    if (!force && state.cameraScaleKey === key) return
    const tiles = layer ? getVisibleTiles(layer, state.floor) : []
    state.camera = computeViewBox(tiles, state.scale === 'local' ? 6 : 8)
    state.cameraScaleKey = key
    applyCamera()
  }

  function applyCamera(): void {
    const { x, y, w, h } = state.camera
    svg.setAttribute('viewBox', `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`)
  }

  function zoom(factor: number): void {
    const { x, y, w, h } = state.camera
    const nw = Math.max(18, Math.min(320, w * factor))
    const nh = Math.max(18, Math.min(320, h * factor))
    state.camera = {
      x: x + (w - nw) / 2,
      y: y + (h - nh) / 2,
      w: nw,
      h: nh,
    }
    applyCamera()
  }

  function renderMapSvg(): void {
    svg.replaceChildren()
    const layer = currentLayer()
    const tiles = layer ? getVisibleTiles(layer, state.floor) : []

    if (!state.activeChatId) {
      hudBadge.textContent = 'No Chat'
      emptyOverlay.hidden = false
      emptyOverlay.replaceChildren(
        el('strong', undefined, 'Open a roleplay chat'),
        el('span', undefined, 'LumiAtlas tracks a separate 3-layer map per chat.'),
      )
      return
    }

    hudBadge.textContent =
      layer && layer.tiles.length > 0
        ? `${layer.name}${state.scale === 'local' ? ` · F${state.floor}` : ''} (${tiles.length})`
        : state.scale.toUpperCase()

    if (!layer || tiles.length === 0) {
      emptyOverlay.hidden = false
      emptyOverlay.replaceChildren(
        el('strong', undefined, `No ${state.scale} tiles yet`),
        el(
          'span',
          undefined,
          state.config.connectionId
            ? 'Click Analyze to generate your 3-layer Atlas.'
            : 'Open Settings to pick your background model (e.g. Terra), then click Analyze.',
        ),
      )
      return
    }

    emptyOverlay.hidden = true
    fitCamera(false)

    // Defs: subtle grid + fog hatch pattern
    const defs = svgEl('defs')
    const gridPat = svgEl('pattern', {
      id: 'la-grid-pat',
      width: 5,
      height: 5,
      patternUnits: 'userSpaceOnUse',
    })
    gridPat.append(
      svgEl('path', {
        d: 'M 5 0 L 0 0 0 5',
        fill: 'none',
        stroke: 'rgba(255,255,255,0.045)',
        'stroke-width': 0.25,
      }),
    )
    const fogPat = svgEl('pattern', {
      id: 'la-fog-pat',
      width: 4,
      height: 4,
      patternUnits: 'userSpaceOnUse',
      patternTransform: 'rotate(45)',
    })
    fogPat.append(
      svgEl('rect', { width: 4, height: 4, fill: '#262938' }),
      svgEl('line', {
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 4,
        stroke: 'rgba(255,255,255,0.12)',
        'stroke-width': 1.2,
      }),
    )
    defs.append(gridPat, fogPat)
    svg.append(defs)

    // Background grid rect
    svg.append(
      svgEl('rect', {
        x: -300,
        y: -300,
        width: 600,
        height: 600,
        fill: 'url(#la-grid-pat)',
      }),
    )

    const tileById = new Map(tiles.map((t) => [t.id, t]))

    // 1. Tiles layer
    const tilesLayer = svgEl('g', { class: 'la-layer-tiles' })
    for (const tile of tiles) {
      const isCurrent = layer.currentTileId === tile.id || tile.status === 'current'
      const isSelected = state.selectedTileId === tile.id
      const isFog = tile.status === 'locked' || tile.status === 'unexplored'
      const isRumored = tile.status === 'rumored'

      const g = svgEl('g', {
        class: `la-tile-group${isCurrent ? ' la-tile-current' : ''}${isSelected ? ' la-tile-selected' : ''}`,
        'data-tile-id': tile.id,
      })

      const fillColor = isFog ? 'url(#la-fog-pat)' : defaultTileColor(tile, state.scale)
      const rect = svgEl('rect', {
        class: 'la-tile-rect',
        x: tile.x,
        y: tile.y,
        width: tile.w,
        height: tile.h,
        rx: state.scale === 'local' ? 0.8 : 1.2,
        fill: fillColor,
        stroke: isFog ? '#6b7280' : 'rgba(255,255,255,0.28)',
        'stroke-width': state.scale === 'local' ? 0.35 : 0.4,
      })
      if (isRumored) rect.setAttribute('stroke-dasharray', '1.4 1.1')
      g.append(rect)

      // Subtle top sheen
      if (!isFog) {
        g.append(
          svgEl('rect', {
            x: tile.x + 0.2,
            y: tile.y + 0.2,
            width: Math.max(0, tile.w - 0.4),
            height: Math.max(0, tile.h * 0.32),
            fill: 'rgba(255,255,255,0.06)',
            'pointer-events': 'none',
          }),
        )
      }

      if (state.showLabels) {
        const cx = tile.x + tile.w / 2
        const cy = tile.y + tile.h / 2
        const fontSize = Math.max(1.5, Math.min(3.1, Math.min(tile.w / 6.2, tile.h / 3.4)))
        const displayName =
          tile.name.length > Math.floor(tile.w * 1.45)
            ? `${tile.name.slice(0, Math.max(6, Math.floor(tile.w * 1.45) - 1))}…`
            : tile.name

        const label = svgEl('text', {
          class: 'la-tile-label',
          x: cx,
          y: tile.sizeLabel ? cy - fontSize * 0.25 : cy + fontSize * 0.32,
          'text-anchor': 'middle',
          'font-size': fontSize.toFixed(2),
        })
        label.textContent = isFog ? `🔒 ${displayName}` : displayName
        g.append(label)

        if (tile.sizeLabel && !isFog) {
          const sizeText = svgEl('text', {
            class: 'la-tile-size',
            x: cx,
            y: cy + fontSize * 0.95,
            'text-anchor': 'middle',
            'font-size': (fontSize * 0.72).toFixed(2),
          })
          sizeText.textContent = tile.sizeLabel
          g.append(sizeText)
        }
      }

      const titleTag = svgEl('title')
      titleTag.textContent = `${tile.name}${tile.sizeLabel ? ` (${tile.sizeLabel})` : ''}${tile.summary ? `\n${tile.summary}` : ''}`
      g.append(titleTag)

      g.addEventListener('click', (ev) => {
        ev.stopPropagation()
        state.selectedTileId = tile.id
        renderAll()
      })

      tilesLayer.append(g)
    }
    svg.append(tilesLayer)

    // 2. Roads & Doors layer
    if (state.showRoads && layer.roads.length > 0) {
      const roadsLayer = svgEl('g', { class: 'la-layer-roads', 'pointer-events': 'none' })
      for (const road of layer.roads) {
        const a = tileById.get(road.from)
        const b = tileById.get(road.to)
        if (!a || !b) continue

        const shared = findSharedEdge(a, b)
        if (state.scale === 'local' && shared && road.kind === 'door') {
          const doorLen = 2.4
          const x1 = shared.orientation === 'horizontal' ? shared.midX - doorLen / 2 : shared.midX
          const y1 = shared.orientation === 'vertical' ? shared.midY - doorLen / 2 : shared.midY
          const x2 = shared.orientation === 'horizontal' ? shared.midX + doorLen / 2 : shared.midX
          const y2 = shared.orientation === 'vertical' ? shared.midY + doorLen / 2 : shared.midY
          roadsLayer.append(
            svgEl('line', {
              x1,
              y1,
              x2,
              y2,
              stroke: '#f5d08a',
              'stroke-width': 1.15,
              'stroke-linecap': 'round',
            }),
          )
        } else {
          const [x1, y1, x2, y2] = connectorSegment(a, b)
          const strokeColor =
            road.kind === 'sea_route'
              ? '#60a5fa'
              : road.kind === 'transit'
                ? '#c084fc'
                : road.kind === 'stairs'
                  ? '#fde047'
                  : '#d4b47c'

          // Outer dark casing for contrast
          roadsLayer.append(
            svgEl('line', {
              x1,
              y1,
              x2,
              y2,
              stroke: 'rgba(15,17,26,0.75)',
              'stroke-width': road.kind === 'road' ? 1.4 : 1.0,
              'stroke-linecap': 'round',
            }),
          )
          const line = svgEl('line', {
            x1,
            y1,
            x2,
            y2,
            stroke: strokeColor,
            'stroke-width': road.kind === 'road' ? 0.72 : 0.5,
            'stroke-linecap': 'round',
          })
          if (road.kind === 'path' || road.kind === 'sea_route' || road.kind === 'stairs') {
            line.setAttribute('stroke-dasharray', '1.4 1.1')
          }
          roadsLayer.append(line)
        }
      }
      svg.append(roadsLayer)
    }

    // 3. Character Pins layer
    if (state.showPins) {
      const pinsLayer = svgEl('g', { class: 'la-layer-pins' })
      for (const tile of tiles) {
        if (!tile.pins.length) continue
        for (const pin of tile.pins) {
          const px = tile.x + tile.w * pin.x
          const py = tile.y + tile.h * pin.y
          const color = defaultPinColor(pin)
          const pinGroup = svgEl('g', { style: 'cursor:pointer' })

          if (pin.isPlayer) {
            pinGroup.append(
              svgEl('circle', {
                cx: px,
                cy: py,
                r: 2.0,
                fill: 'rgba(254, 240, 138, 0.28)',
                stroke: '#fde047',
                'stroke-width': 0.3,
              }),
            )
          }

          pinGroup.append(
            svgEl('circle', {
              cx: px,
              cy: py,
              r: pin.isPlayer ? 1.15 : 0.95,
              fill: color,
              stroke: '#0f111a',
              'stroke-width': 0.35,
            }),
          )

          const pinLabel = svgEl('text', {
            class: 'la-pin-label',
            x: px,
            y: py - 1.5,
            'text-anchor': 'middle',
            'font-size': '1.65',
          })
          pinLabel.textContent = pin.name
          pinGroup.append(pinLabel)

          const pinTitle = svgEl('title')
          pinTitle.textContent = `${pin.name}${pin.note ? ` — ${pin.note}` : ''}`
          pinGroup.append(pinTitle)

          pinGroup.addEventListener('click', (ev) => {
            ev.stopPropagation()
            state.selectedTileId = tile.id
            renderAll()
          })

          pinsLayer.append(pinGroup)
        }
      }
      svg.append(pinsLayer)
    }
  }

  function renderInspector(): void {
    inspector.replaceChildren()
    const layer = currentLayer()
    if (!layer || !layer.tiles.length) {
      inspector.append(
        el('div', 'la-subtitle', 'Select a tile after analyzing to inspect features, character pins, and routes.'),
      )
      return
    }

    const visible = getVisibleTiles(layer, state.floor)
    const tile =
      visible.find((t) => t.id === state.selectedTileId) ??
      visible.find((t) => t.id === layer.currentTileId) ??
      visible[0]

    if (!tile) return

    const head = el('div', 'la-insp-head')
    head.append(el('div', 'la-insp-title', tile.name))

    const pills = el('div', 'la-pill-row')
    const statusClass =
      tile.status === 'current' || layer.currentTileId === tile.id
        ? 'la-pill la-pill-current'
        : tile.status === 'locked' || tile.status === 'unexplored'
          ? 'la-pill la-pill-locked'
          : 'la-pill'
    pills.append(el('span', statusClass, layer.currentTileId === tile.id ? 'here' : tile.status))
    pills.append(el('span', 'la-pill', tile.kind))
    if (tile.sizeLabel) pills.append(el('span', 'la-pill', tile.sizeLabel))
    head.append(pills)
    inspector.append(head)

    if (tile.summary) {
      inspector.append(el('p', 'la-insp-summary', tile.summary))
    }

    if (tile.features.length > 0 && tile.status !== 'locked' && tile.status !== 'unexplored') {
      inspector.append(el('div', 'la-insp-section-label', 'Features & Hooks'))
      const ul = el('ul', 'la-feature-list')
      for (const feat of tile.features) {
        ul.append(el('li', undefined, feat))
      }
      inspector.append(ul)
    }

    if (tile.pins.length > 0) {
      inspector.append(el('div', 'la-insp-section-label', 'Characters Here'))
      const row = el('div', 'la-chip-row')
      for (const pin of tile.pins) {
        const chip = el('span', 'la-pin-chip')
        const dot = el('span', 'la-pin-dot')
        dot.style.background = defaultPinColor(pin)
        chip.append(
          dot,
          document.createTextNode(pin.note ? `${pin.name} (${pin.note})` : pin.name),
        )
        row.append(chip)
      }
      inspector.append(row)
    }

    const neighborIds = new Set<string>(tile.connections)
    for (const road of layer.roads) {
      if (road.from === tile.id) neighborIds.add(road.to)
      if (road.to === tile.id) neighborIds.add(road.from)
    }
    const neighbors = Array.from(neighborIds)
      .map((id) => layer.tiles.find((t) => t.id === id))
      .filter((t): t is Tile => !!t)

    if (neighbors.length > 0) {
      inspector.append(el('div', 'la-insp-section-label', 'Connected Routes'))
      const row = el('div', 'la-chip-row')
      for (const n of neighbors) {
        const btn = el(
          'button',
          'la-neighbor-btn',
          n.floor !== tile.floor ? `${n.name} (F${n.floor})` : n.name,
        )
        btn.type = 'button'
        btn.addEventListener('click', () => {
          state.floor = n.floor
          state.selectedTileId = n.id
          fitCamera(true)
          renderAll()
        })
        row.append(btn)
      }
      inspector.append(row)
    }

    if (state.atlas?.notes && state.atlas.notes.length > 0) {
      inspector.append(el('div', 'la-notes', state.atlas.notes.join(' · ')))
    }
  }

  function renderAll(): void {
    if (state.destroyed) return

    // Header
    locationEl.textContent = state.atlas?.currentLocation && state.atlas.currentLocation !== 'Unknown'
      ? state.atlas.currentLocation
      : 'LumiAtlas'
    subtitleEl.textContent = state.statusMessage

    const hasChat = !!state.activeChatId
    const hasConn = !!state.config.connectionId
    analyzeBtn.disabled = !hasChat || !hasConn || state.busy
    rebuildBtn.disabled = !hasChat || !hasConn || state.busy
    cancelBtn.hidden = !state.busy
    settingsBtn.classList.toggle('la-btn-active', state.settingsOpen)
    settingsBox.hidden = !state.settingsOpen

    // Connection dropdown
    connSelect.replaceChildren()
    const blank = el('option', undefined, state.connections.length ? '— Select a connection —' : 'No connections available')
    blank.value = ''
    connSelect.append(blank)
    for (const c of state.connections) {
      const opt = el('option', undefined, c.model ? `${c.name} (${c.model})` : c.name)
      opt.value = c.id
      connSelect.append(opt)
    }
    connSelect.value = state.config.connectionId ?? ''

    enabledInput.checked = state.config.enabled
    enabledInput.disabled = !hasChat
    autoInput.checked = state.config.autoUpdate
    autoInput.disabled = !hasChat || !state.config.enabled
    reasoningInput.checked = state.config.reasoningMode !== 'off'

    // Banners
    errorBanner.hidden = !state.error
    errorBanner.textContent = state.error ?? ''
    staleBanner.hidden = !state.atlas?.stale
    staleBanner.textContent = state.atlas?.staleReason ?? ''

    // Live thinking / generation stream box
    const hasStream = state.busy || Boolean(state.stream && (state.stream.reasoning || state.stream.outputChars > 0))
    thinkingBox.hidden = !hasStream
    if (hasStream) {
      const phase = state.stream?.phase ?? 'thinking'
      const reasoningText = state.stream?.reasoning ?? ''
      const outChars = state.stream?.outputChars ?? 0
      thinkingDot.classList.toggle('la-pulse', state.busy)
      if (state.busy) {
        thinkingLabel.textContent =
          phase === 'writing'
            ? 'Writing Atlas JSON…'
            : reasoningText
              ? 'Model thinking…'
              : 'Waiting for model…'
      } else {
        thinkingLabel.textContent = reasoningText ? 'Last generation thoughts' : 'Last generation output'
      }
      const metaParts: string[] = []
      if (reasoningText) metaParts.push(`${reasoningText.length} thinking chars`)
      if (outChars > 0) metaParts.push(`${outChars} JSON chars`)
      metaParts.push(state.thinkingOpen ? 'Hide' : 'Show')
      thinkingMeta.textContent = metaParts.join(' · ')

      thinkingBody.hidden = !state.thinkingOpen
      if (state.thinkingOpen) {
        if (reasoningText) {
          thinkingBody.textContent = reasoningText
        } else if (state.stream?.outputTail) {
          thinkingBody.textContent = `Generating map JSON (${outChars} chars)…\n${state.stream.outputTail}`
        } else if (state.busy) {
          thinkingBody.textContent =
            state.config.reasoningMode === 'off'
              ? 'Streaming JSON directly (thinking disabled in Settings)…'
              : 'Waiting for reasoning tokens from model…'
        } else {
          thinkingBody.textContent = ''
        }
        thinkingBody.scrollTop = thinkingBody.scrollHeight
      }
    }

    // Scale tabs
    for (const s of ['local', 'region', 'world'] as Scale[]) {
      const count = state.atlas?.maps?.[s]?.tiles.length ?? 0
      const label = s === 'local' ? 'Local' : s === 'region' ? 'Region' : 'World'
      scaleButtons[s].textContent = count > 0 ? `${label} (${count})` : label
      scaleButtons[s].setAttribute('aria-selected', String(state.scale === s))
    }

    // Local / Region tileset dropdown
    const layers = availableLayers(state.scale)
    const showLayerDropdown = (state.scale === 'local' || state.scale === 'region') && layers.length > 0
    layerBar.hidden = !showLayerDropdown
    if (showLayerDropdown) {
      layerBarLabel.textContent = state.scale === 'local' ? 'Local Zone' : 'Region'
      layerSelect.replaceChildren()
      const activeId = state.atlas?.maps?.[state.scale]?.id ?? null
      for (const l of layers) {
        const isCurrent = l.id === activeId
        const opt = el(
          'option',
          undefined,
          `${l.name} (${l.tiles.length} tiles)${isCurrent ? ' · Current' : ''}`,
        )
        opt.value = l.id
        layerSelect.append(opt)
      }
      const currentId = currentLayer()?.id ?? layers[0]?.id ?? ''
      layerSelect.value = currentId
    }

    // Floors (Local only when > 1 floor)
    floorBar.replaceChildren()
    const layer = currentLayer()
    if (layer && state.scale === 'local') {
      const floors = getFloors(layer)
      if (floors.length > 1) {
        for (const f of floors) {
          const btn = el('button', `la-btn${state.floor === f ? ' la-btn-active' : ''}`, `F${f}`)
          btn.type = 'button'
          btn.addEventListener('click', () => {
            state.floor = f
            fitCamera(true)
            renderAll()
          })
          floorBar.append(btn)
        }
      }
    }

    pinsToggle.classList.toggle('la-btn-active', state.showPins)
    roadsToggle.classList.toggle('la-btn-active', state.showRoads)
    labelsToggle.classList.toggle('la-btn-active', state.showLabels)

    renderMapSvg()
    renderInspector()
  }

  // Event wiring
  const on = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (ev: HTMLElementEventMap[K]) => void,
  ) => {
    target.addEventListener(type, handler as EventListener)
    cleanups.push(() => target.removeEventListener(type, handler as EventListener))
  }

  on(settingsBtn, 'click', () => {
    state.settingsOpen = !state.settingsOpen
    renderAll()
  })

  on(connSelect, 'change', () => {
    const val = connSelect.value || null
    state.config.connectionId = val
    state.error = null
    send({ type: 'set_connection', connectionId: val })
    renderAll()
  })

  on(enabledInput, 'change', () => {
    if (!state.activeChatId) return
    state.config.enabled = enabledInput.checked
    send({
      type: 'set_chat_config',
      chatId: state.activeChatId,
      enabled: state.config.enabled,
      autoUpdate: state.config.autoUpdate,
    })
    renderAll()
  })

  on(autoInput, 'change', () => {
    if (!state.activeChatId) return
    state.config.autoUpdate = autoInput.checked
    send({
      type: 'set_chat_config',
      chatId: state.activeChatId,
      enabled: state.config.enabled,
      autoUpdate: state.config.autoUpdate,
    })
    renderAll()
  })

  on(reasoningInput, 'change', () => {
    const reasoningMode = reasoningInput.checked ? 'inherit' : 'off'
    state.config.reasoningMode = reasoningMode
    send({ type: 'set_reasoning_mode', reasoningMode })
    renderAll()
  })

  on(thinkingHead, 'click', () => {
    state.thinkingOpen = !state.thinkingOpen
    renderAll()
  })

  on(layerSelect, 'change', () => {
    const picked = layerSelect.value || null
    const activeId = state.atlas?.maps?.[state.scale]?.id ?? null
    state.selectedLayerId[state.scale] = picked === activeId ? null : picked
    const layer = currentLayer()
    state.floor = layer?.activeFloor ?? 0
    state.selectedTileId = layer?.currentTileId ?? null
    fitCamera(true)
    renderAll()
  })

  on(refreshBtn, 'click', () => {
    state.error = null
    requestInit()
  })

  on(analyzeBtn, 'click', () => {
    if (!state.activeChatId || state.busy) return
    state.error = null
    state.busy = true
    state.stream = { phase: 'thinking', reasoning: '', outputChars: 0, outputTail: '' }
    state.thinkingOpen = true
    state.statusMessage = 'Requesting Atlas update…'
    send({ type: 'analyze', chatId: state.activeChatId, mode: 'update' })
    renderAll()
  })

  on(rebuildBtn, 'click', () => {
    if (!state.activeChatId || state.busy) return
    state.error = null
    state.busy = true
    state.stream = { phase: 'thinking', reasoning: '', outputChars: 0, outputTail: '' }
    state.thinkingOpen = true
    state.statusMessage = 'Requesting fresh 3-layer rebuild…'
    send({ type: 'analyze', chatId: state.activeChatId, mode: 'rebuild' })
    renderAll()
  })

  on(cancelBtn, 'click', () => {
    if (!state.activeChatId) return
    send({ type: 'cancel', chatId: state.activeChatId })
  })

  for (const s of ['local', 'region', 'world'] as Scale[]) {
    on(scaleButtons[s], 'click', () => {
      if (state.scale === s) return
      state.scale = s
      const layer = currentLayer()
      state.selectedTileId = layer?.currentTileId ?? null
      state.floor = layer?.activeFloor ?? 0
      fitCamera(true)
      renderAll()
    })
  }

  on(pinsToggle, 'click', () => {
    state.showPins = !state.showPins
    renderAll()
  })
  on(roadsToggle, 'click', () => {
    state.showRoads = !state.showRoads
    renderAll()
  })
  on(labelsToggle, 'click', () => {
    state.showLabels = !state.showLabels
    renderAll()
  })

  on(zoomInBtn, 'click', () => zoom(0.78))
  on(zoomOutBtn, 'click', () => zoom(1.28))
  on(fitBtn, 'click', () => fitCamera(true))

  // Pointer pan + wheel zoom
  let dragging = false
  let dragStartX = 0
  let dragStartY = 0
  let camStartX = 0
  let camStartY = 0

  on(canvasWrap, 'pointerdown', (ev) => {
    if (ev.button !== 0 || (ev.target as HTMLElement)?.closest('button')) return
    dragging = true
    dragStartX = ev.clientX
    dragStartY = ev.clientY
    camStartX = state.camera.x
    camStartY = state.camera.y
    canvasWrap.classList.add('la-dragging')
    try {
      canvasWrap.setPointerCapture(ev.pointerId)
    } catch {
      // ignore if unsupported in mock DOM
    }
  })

  on(canvasWrap, 'pointermove', (ev) => {
    if (!dragging) return
    const rect = canvasWrap.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const scaleX = state.camera.w / rect.width
    const scaleY = state.camera.h / rect.height
    state.camera.x = camStartX - (ev.clientX - dragStartX) * scaleX
    state.camera.y = camStartY - (ev.clientY - dragStartY) * scaleY
    applyCamera()
  })

  const endDrag = () => {
    dragging = false
    canvasWrap.classList.remove('la-dragging')
  }
  on(canvasWrap, 'pointerup', endDrag)
  on(canvasWrap, 'pointercancel', endDrag)

  on(canvasWrap, 'wheel', (ev) => {
    ev.preventDefault()
    zoom(ev.deltaY > 0 ? 1.14 : 0.88)
  })

  // Backend message handling
  const unsubBackend = ctx.onBackendMessage((raw: unknown) => {
    if (state.destroyed || !raw || typeof raw !== 'object') return
    const msg = raw as BackendToFrontendMessage

    if (msg.type === 'init') {
      if (pendingRequestId && msg.requestId && msg.requestId !== pendingRequestId) return
      pendingRequestId = null
      state.activeChatId = msg.activeChatId
      state.config = msg.config
      state.connections = msg.connections
      state.atlas = msg.state
      state.archives = msg.archives ?? { local: [], region: [], world: [] }
      state.selectedLayerId = { local: null, region: null, world: null }
      state.busy = msg.busy
      if (!msg.busy) state.stream = null
      state.statusMessage = msg.statusMessage
      state.error = msg.error
      if (!msg.config.connectionId) state.settingsOpen = true
      state.floor = msg.state?.maps?.[state.scale]?.activeFloor ?? 0
      state.selectedTileId = msg.state?.maps?.[state.scale]?.currentTileId ?? null
      fitCamera(true)
      renderAll()
      return
    }

    if (msg.type === 'stream') {
      if (msg.chatId && state.activeChatId && msg.chatId !== state.activeChatId) return
      state.busy = true
      state.stream = {
        phase: msg.phase,
        reasoning: msg.reasoning,
        outputChars: msg.outputChars,
        outputTail: msg.outputTail,
      }
      renderAll()
      return
    }

    if (msg.type === 'status') {
      if (msg.chatId && state.activeChatId && msg.chatId !== state.activeChatId) return
      if (msg.config) state.config = msg.config
      if (msg.archives) state.archives = msg.archives
      if (msg.state !== undefined) {
        state.atlas = msg.state
        if (msg.status === 'ready') {
          state.selectedLayerId = { local: null, region: null, world: null }
        }
        if (msg.state && !state.selectedTileId) {
          state.selectedTileId = msg.state.maps[state.scale]?.currentTileId ?? null
        }
      }
      state.busy = msg.status === 'updating'
      state.statusMessage = msg.message
      state.error = msg.status === 'error' ? msg.message : null
      if (msg.status === 'ready') {
        tab.setBadge(null)
        if (state.stream && !state.stream.reasoning) {
          state.stream = null
        } else if (state.stream) {
          state.thinkingOpen = false
        }
        fitCamera(true)
      } else if (msg.status === 'updating') {
        tab.setBadge('…')
      } else if (msg.status === 'stale') {
        tab.setBadge('!')
      } else if (msg.status === 'idle' || msg.status === 'error') {
        tab.setBadge(null)
      }
      renderAll()
    }
  })

  const unsubChat = ctx.events.on('CHAT_SWITCHED', (payload: unknown) => {
    const nextId =
      payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).chatId === 'string'
        ? ((payload as Record<string, unknown>).chatId as string)
        : null
    state.activeChatId = nextId
    state.atlas = null
    state.archives = { local: [], region: [], world: [] }
    state.selectedLayerId = { local: null, region: null, world: null }
    state.selectedTileId = null
    state.busy = false
    state.stream = null
    state.error = null
    state.statusMessage = nextId ? 'Loading Atlas…' : 'Open a chat to view its Atlas.'
    state.cameraScaleKey = ''
    renderAll()
    requestInit()
  })

  const unsubActivate = tab.onActivate(() => {
    requestInit()
  })

  renderAll()
  requestInit()

  return () => {
    state.destroyed = true
    for (const off of cleanups) off()
    unsubActivate()
    unsubChat()
    unsubBackend()
    removeStyle()
    tab.destroy()
  }
}
