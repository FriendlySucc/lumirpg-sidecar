import type { AtlasState, MapLayer, Pin, Road, Scale, Tile, TileKind, TileStatus } from './types.js'

export const SCALES: Scale[] = ['local', 'region', 'world']

const VALID_KINDS = new Set<TileKind>([
  'room', 'hallway', 'street', 'shop', 'landmark', 'settlement', 'district',
  'region', 'kingdom', 'mountain', 'water', 'forest', 'desert', 'marsh',
  'ruin', 'exit', 'other',
])

const VALID_STATUSES = new Set<TileStatus>([
  'current', 'visited', 'known', 'rumored', 'locked', 'unexplored',
])

const VALID_ROAD_KINDS = new Set<Road['kind']>([
  'road', 'path', 'door', 'stairs', 'transit', 'sea_route',
])

const REGION_PALETTE = [
  '#8b5a7c',
  '#4e7a8c',
  '#8c6f4e',
  '#5c7c5a',
  '#8c5a5a',
  '#5e648c',
  '#7c764e',
  '#4e7c71',
  '#7c5e8a',
  '#8a624a',
]

const PIN_PALETTE = [
  '#f59e0b',
  '#38bdf8',
  '#f472b6',
  '#4ade80',
  '#c084fc',
  '#fb7185',
  '#2dd4bf',
  '#facc15',
]

export function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function slugify(raw: string, fallback = 'tile'): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
  return cleaned || fallback
}

export function cleanText(value: unknown, maxLen = 280): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
}

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())
}

export function defaultTileColor(tile: Pick<Tile, 'id' | 'name' | 'kind' | 'status' | 'color'>, scale: Scale): string {
  if (tile.status === 'locked' || tile.status === 'unexplored') return '#2e3142'
  if (isValidHexColor(tile.color)) return tile.color.trim()

  switch (tile.kind) {
    case 'water':
      return '#2c5473'
    case 'mountain':
      return '#5c5a66'
    case 'forest':
      return '#365947'
    case 'desert':
      return '#8a734b'
    case 'marsh':
      return '#475c52'
    case 'ruin':
      return '#664a52'
    case 'hallway':
    case 'street':
      return '#3d4257'
    case 'exit':
      return '#4c576e'
    case 'shop':
      return '#5d4d6e'
    default:
      break
  }

  if (scale === 'world' || scale === 'region') {
    const idx = hashString(tile.id || tile.name) % REGION_PALETTE.length
    return REGION_PALETTE[idx]
  }

  return '#363c52'
}

export function defaultPinColor(pin: Pick<Pin, 'name' | 'color' | 'isPlayer'>): string {
  if (pin.isPlayer) return '#fef08a'
  if (isValidHexColor(pin.color)) return pin.color.trim()
  return PIN_PALETTE[hashString(pin.name.toLowerCase()) % PIN_PALETTE.length]
}

export function emptyLayer(scale: Scale): MapLayer {
  return {
    id: `${scale}_default`,
    name: scale === 'local' ? 'Local' : scale === 'region' ? 'Region' : 'World',
    scale,
    currentTileId: null,
    activeFloor: 0,
    tiles: [],
    roads: [],
  }
}

export function emptyAtlasState(chatId: string): AtlasState {
  return {
    version: 1,
    chatId,
    updatedAt: new Date().toISOString(),
    analyzedMessageId: null,
    analyzedMessageCount: 0,
    stale: false,
    staleReason: '',
    currentLocation: 'Unknown',
    maps: {
      local: emptyLayer('local'),
      region: emptyLayer('region'),
      world: emptyLayer('world'),
    },
    notes: ['No map snapshot yet. Click Analyze to chart this chat.'],
  }
}

/** Extract JSON object from raw LLM output (handles markdown fences or surrounding prose). */
export function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Analyzer returned an empty response.')

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed

  try {
    const parsed = JSON.parse(candidate)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Fall through to balanced-brace extraction
  }

  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const slice = candidate.slice(start, end + 1)
    try {
      const parsed = JSON.parse(slice)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Fall through
    }
  }

  throw new Error('Analyzer response did not contain valid JSON.')
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function finiteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function snapGrid(value: number, step = 5): number {
  return Math.round(value / step) * step
}

function normalizeKind(raw: unknown, scale: Scale): TileKind {
  const s = cleanText(raw, 40).toLowerCase().replace(/[\s-]+/g, '_')
  if (VALID_KINDS.has(s as TileKind)) return s as TileKind
  if (/sea|ocean|lake|river|bay|harbor|canal|water/.test(s)) return 'water'
  if (/mount|peak|ridge|cliff|crag/.test(s)) return 'mountain'
  if (/forest|wood|jungle|grove/.test(s)) return 'forest'
  if (/desert|dune|waste|badland/.test(s)) return 'desert'
  if (/marsh|swamp|bog|fen/.test(s)) return 'marsh'
  if (/ruin|dungeon|crypt|wreck/.test(s)) return 'ruin'
  if (/hall|corridor|passage|stairs|lift|elevator/.test(s)) return 'hallway'
  if (/street|alley|road|plaza|walkway|avenue/.test(s)) return 'street'
  if (/shop|stall|market|bar|club|cafe|clinic|vendor/.test(s)) return 'shop'
  if (/kingdom|empire|nation|continent|dominion/.test(s)) return 'kingdom'
  if (/region|province|sector|territory/.test(s)) return 'region'
  if (/district|ward|borough|zone/.test(s)) return 'district'
  if (/city|town|village|settlement|camp|outpost|hub/.test(s)) return 'settlement'
  if (/exit|gate|door|portal|station/.test(s)) return 'exit'
  if (/landmark|tower|shrine|monument/.test(s)) return 'landmark'
  return scale === 'local' ? 'room' : scale === 'region' ? 'district' : 'region'
}

function normalizeStatus(raw: unknown): TileStatus {
  const s = cleanText(raw, 32).toLowerCase()
  if (VALID_STATUSES.has(s as TileStatus)) return s as TileStatus
  if (/rumor|heard|legend/.test(s)) return 'rumored'
  if (/lock|sealed|restricted|private/.test(s)) return 'locked'
  if (/unexplor|hidden|unknown|fog/.test(s)) return 'unexplored'
  if (/current|active|here/.test(s)) return 'current'
  if (/visit|seen|entered/.test(s)) return 'visited'
  return 'known'
}

function normalizePin(raw: unknown, tileW: number, tileH: number, index: number): Pin | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const name = cleanText(row.name, 60)
  if (!name) return null

  const rawX = finiteNumber(row.x, NaN)
  const rawY = finiteNumber(row.y, NaN)

  let nx: number
  let ny: number
  if (Number.isFinite(rawX) && Number.isFinite(rawY)) {
    if (rawX >= 0 && rawX <= 1 && rawY >= 0 && rawY <= 1) {
      nx = rawX
      ny = rawY
    } else {
      nx = tileW > 0 ? rawX / tileW : 0.5
      ny = tileH > 0 ? rawY / tileH : 0.5
    }
  } else {
    const cols = 3
    nx = 0.25 + (index % cols) * 0.25
    ny = 0.35 + Math.floor(index / cols) * 0.25
  }

  return {
    id: slugify(cleanText(row.id, 64) || name, `pin_${index}`),
    name,
    x: clamp(nx, 0.14, 0.86),
    y: clamp(ny, 0.22, 0.84),
    note: cleanText(row.note, 80) || undefined,
    color: isValidHexColor(row.color) ? row.color.trim() : undefined,
    isPlayer: row.isPlayer === true || row.is_player === true,
  }
}

export function tilesOverlap(a: Tile, b: Tile): boolean {
  if (a.floor !== b.floor) return false
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/** Gently nudge overlapping newer tiles along the smallest separation axis in 5-unit steps. */
export function resolveOverlaps(tiles: Tile[], preservedIds: Set<string> = new Set()): Tile[] {
  const placed: Tile[] = []

  const ordered = [
    ...tiles.filter((t) => preservedIds.has(t.id)),
    ...tiles.filter((t) => !preservedIds.has(t.id)),
  ]

  for (const original of ordered) {
    const tile: Tile = { ...original }
    if (!preservedIds.has(tile.id)) {
      let attempts = 0
      while (attempts < 40) {
        const blocker = placed.find((other) => tilesOverlap(tile, other))
        if (!blocker) break

        const pushRight = blocker.x + blocker.w - tile.x
        const pushLeft = tile.x + tile.w - blocker.x
        const pushDown = blocker.y + blocker.h - tile.y
        const pushUp = tile.y + tile.h - blocker.y

        const minPush = Math.min(pushRight, pushLeft, pushDown, pushUp)
        if (minPush === pushRight) tile.x = snapGrid(blocker.x + blocker.w)
        else if (minPush === pushLeft) tile.x = snapGrid(blocker.x - tile.w)
        else if (minPush === pushDown) tile.y = snapGrid(blocker.y + blocker.h)
        else tile.y = snapGrid(blocker.y - tile.h)

        attempts++
      }
    }
    placed.push(tile)
  }

  return placed
}

/** Spread pins that land too close to each other inside the same tile. */
export function spreadPins(pins: Pin[]): Pin[] {
  const result = pins.map((p) => ({ ...p }))
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const dx = result[j].x - result[i].x
      const dy = result[j].y - result[i].y
      if (Math.hypot(dx, dy) < 0.14) {
        result[j].x = clamp(result[i].x + ((j % 2 === 0 ? 1 : -1) * 0.18), 0.14, 0.86)
        result[j].y = clamp(result[i].y + (Math.floor(j / 2) * 0.14), 0.22, 0.84)
      }
    }
  }
  return result
}

export function sanitizeLayer(
  raw: unknown,
  scale: Scale,
  previous?: MapLayer,
): MapLayer {
  if (!raw || typeof raw !== 'object') {
    return previous ? { ...previous } : emptyLayer(scale)
  }

  const obj = raw as Record<string, unknown>
  const rawTiles = Array.isArray(obj.tiles) ? obj.tiles : []
  if (rawTiles.length === 0 && previous && previous.tiles.length > 0) {
    return { ...previous }
  }

  const seenIds = new Set<string>()
  const tiles: Tile[] = []

  // Safety net: if a fresh layer uses tiny 1-4 unit coordinates (e.g. w:2, h:2), scale the whole
  // layer up cleanly so proportions and shared edges survive the 5-unit grid snap.
  let unitScale = 1
  if (!previous?.tiles.length && rawTiles.length > 0) {
    let maxDim = 0
    let maxAbsCoord = 0
    let hasExplicitDim = false
    for (const item of rawTiles) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      const rw = finiteNumber(r.w, NaN)
      const rh = finiteNumber(r.h, NaN)
      const rx = finiteNumber(r.x, NaN)
      const ry = finiteNumber(r.y, NaN)
      if (Number.isFinite(rw)) { hasExplicitDim = true; maxDim = Math.max(maxDim, Math.abs(rw)) }
      if (Number.isFinite(rh)) { hasExplicitDim = true; maxDim = Math.max(maxDim, Math.abs(rh)) }
      if (Number.isFinite(rx)) maxAbsCoord = Math.max(maxAbsCoord, Math.abs(rx))
      if (Number.isFinite(ry)) maxAbsCoord = Math.max(maxAbsCoord, Math.abs(ry))
    }
    if (hasExplicitDim && maxDim > 0 && maxDim < 5) {
      unitScale = maxAbsCoord * 10 <= 110 && maxDim * 10 <= 50 ? 10 : 5
    }
  }

  for (let i = 0; i < Math.min(rawTiles.length, 48); i++) {
    const item = rawTiles[i]
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>

    const name = cleanText(row.name, 90)
    if (!name) continue

    let id = slugify(cleanText(row.id, 64) || name, `${scale}_tile_${i}`)
    while (seenIds.has(id)) id = `${id}_${i}`
    seenIds.add(id)

    const rawW = finiteNumber(row.w, NaN)
    const rawH = finiteNumber(row.h, NaN)
    const rawX = finiteNumber(row.x, NaN)
    const rawY = finiteNumber(row.y, NaN)
    const w = clamp(snapGrid(Math.max(5, Number.isFinite(rawW) ? rawW * unitScale : (scale === 'local' ? 10 : 15))), 5, 60)
    const h = clamp(snapGrid(Math.max(5, Number.isFinite(rawH) ? rawH * unitScale : (scale === 'local' ? 10 : 15))), 5, 60)
    const x = clamp(snapGrid(Number.isFinite(rawX) ? rawX * unitScale : (i % 4) * 15 - 30), -120, 120)
    const y = clamp(snapGrid(Number.isFinite(rawY) ? rawY * unitScale : Math.floor(i / 4) * 15 - 30), -120, 120)
    const floor = scale === 'local' ? clamp(Math.round(finiteNumber(row.floor, 0)), -10, 40) : 0

    const features = Array.isArray(row.features)
      ? row.features.map((f) => cleanText(f, 120)).filter(Boolean).slice(0, 10)
      : []

    const rawPins = Array.isArray(row.pins) ? row.pins : []
    const pins = spreadPins(
      rawPins
        .map((p, idx) => normalizePin(p, w, h, idx))
        .filter((p): p is Pin => p !== null)
        .slice(0, 16),
    )

    const connections = Array.isArray(row.connections)
      ? Array.from(
          new Set(
            row.connections
              .map((c) => slugify(cleanText(c, 64), ''))
              .filter((c) => c && c !== id),
          ),
        ).slice(0, 12)
      : []

    const status = normalizeStatus(row.status)
    const kind = normalizeKind(row.kind, scale)

    tiles.push({
      id,
      name,
      kind,
      status,
      x,
      y,
      w,
      h,
      floor,
      sizeLabel: cleanText(row.sizeLabel ?? row.size_label ?? row.size, 32),
      color: isValidHexColor(row.color) ? row.color.trim() : undefined,
      summary: cleanText(row.summary, 280),
      features,
      pins,
      connections,
    })
  }

  const tileIdSet = new Set(tiles.map((t) => t.id))
  for (const tile of tiles) {
    tile.connections = tile.connections.filter((target) => tileIdSet.has(target))
  }

  const preservedIds = new Set(
    previous ? previous.tiles.map((t) => t.id).filter((id) => tileIdSet.has(id)) : [],
  )
  const repairedTiles = resolveOverlaps(tiles, preservedIds)

  const roadMap = new Map<string, Road>()
  const rawRoads = Array.isArray(obj.roads) ? obj.roads : []
  for (const item of rawRoads) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const from = slugify(cleanText(r.from, 64), '')
    const to = slugify(cleanText(r.to, 64), '')
    if (!from || !to || from === to || !tileIdSet.has(from) || !tileIdSet.has(to)) continue
    const key = from < to ? `${from}::${to}` : `${to}::${from}`
    const kindRaw = cleanText(r.kind, 24).toLowerCase() as Road['kind']
    roadMap.set(key, {
      from,
      to,
      kind: VALID_ROAD_KINDS.has(kindRaw) ? kindRaw : scale === 'local' ? 'door' : 'road',
      label: cleanText(r.label, 48) || undefined,
    })
  }

  for (const tile of repairedTiles) {
    for (const target of tile.connections) {
      const key = tile.id < target ? `${tile.id}::${target}` : `${target}::${tile.id}`
      if (!roadMap.has(key)) {
        roadMap.set(key, {
          from: tile.id,
          to: target,
          kind: scale === 'local' ? 'door' : 'road',
        })
      }
    }
  }

  const rawCurrent = slugify(cleanText(obj.currentTileId ?? obj.current_tile_id, 64), '')
  const currentTileId = tileIdSet.has(rawCurrent)
    ? rawCurrent
    : repairedTiles.find((t) => t.status === 'current')?.id ?? null

  const currentTile = repairedTiles.find((t) => t.id === currentTileId)
  const activeFloor = scale === 'local'
    ? currentTile?.floor ?? Math.round(finiteNumber(obj.activeFloor ?? obj.active_floor, 0))
    : 0

  return {
    id: slugify(cleanText(obj.id, 64) || `${scale}_map`, `${scale}_map`),
    name: cleanText(obj.name, 80) || (scale === 'local' ? 'Local' : scale === 'region' ? 'Region' : 'World'),
    scale,
    currentTileId,
    activeFloor,
    tiles: repairedTiles,
    roads: Array.from(roadMap.values()),
  }
}

export function sanitizeProposal(
  raw: Record<string, unknown>,
  chatId: string,
  messageId: string | null,
  messageCount: number,
  previous?: AtlasState,
): AtlasState {
  const rawMaps = (raw.maps && typeof raw.maps === 'object' ? raw.maps : {}) as Record<string, unknown>

  const maps: Record<Scale, MapLayer> = {
    local: sanitizeLayer(rawMaps.local, 'local', previous?.maps.local),
    region: sanitizeLayer(rawMaps.region, 'region', previous?.maps.region),
    world: sanitizeLayer(rawMaps.world, 'world', previous?.maps.world),
  }

  const currentLocalTile = maps.local.tiles.find((t) => t.id === maps.local.currentTileId)
  const currentRegionTile = maps.region.tiles.find((t) => t.id === maps.region.currentTileId)
  const currentLocation =
    cleanText(raw.currentLocation ?? raw.current_location, 120) ||
    currentLocalTile?.name ||
    currentRegionTile?.name ||
    previous?.currentLocation ||
    'Unknown'

  const notes = Array.isArray(raw.notes)
    ? raw.notes.map((n) => cleanText(n, 200)).filter(Boolean).slice(0, 8)
    : []

  return {
    version: 1,
    chatId,
    updatedAt: new Date().toISOString(),
    analyzedMessageId: messageId,
    analyzedMessageCount: messageCount,
    stale: false,
    staleReason: '',
    currentLocation,
    maps,
    notes,
  }
}

export interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

export function computeViewBox(tiles: Tile[], padding = 8): ViewBox {
  if (!tiles.length) return { x: -50, y: -50, w: 100, h: 100 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const t of tiles) {
    if (t.x < minX) minX = t.x
    if (t.y < minY) minY = t.y
    if (t.x + t.w > maxX) maxX = t.x + t.w
    if (t.y + t.h > maxY) maxY = t.y + t.h
  }

  const w = Math.max(40, maxX - minX + padding * 2)
  const h = Math.max(40, maxY - minY + padding * 2)
  return {
    x: minX - padding,
    y: minY - padding,
    w,
    h,
  }
}

export interface SharedEdge {
  x1: number
  y1: number
  x2: number
  y2: number
  midX: number
  midY: number
  orientation: 'vertical' | 'horizontal'
}

/** Find shared border segment between two touching tiles (within epsilon). */
export function findSharedEdge(a: Tile, b: Tile, eps = 0.5): SharedEdge | null {
  if (Math.abs(a.x + a.w - b.x) <= eps || Math.abs(b.x + b.w - a.x) <= eps) {
    const edgeX = Math.abs(a.x + a.w - b.x) <= eps ? a.x + a.w : a.x
    const top = Math.max(a.y, b.y)
    const bottom = Math.min(a.y + a.h, b.y + b.h)
    if (bottom - top >= 2) {
      return {
        x1: edgeX,
        y1: top,
        x2: edgeX,
        y2: bottom,
        midX: edgeX,
        midY: (top + bottom) / 2,
        orientation: 'vertical',
      }
    }
  }

  if (Math.abs(a.y + a.h - b.y) <= eps || Math.abs(b.y + b.h - a.y) <= eps) {
    const edgeY = Math.abs(a.y + a.h - b.y) <= eps ? a.y + a.h : a.y
    const left = Math.max(a.x, b.x)
    const right = Math.min(a.x + a.w, b.x + b.w)
    if (right - left >= 2) {
      return {
        x1: left,
        y1: edgeY,
        x2: right,
        y2: edgeY,
        midX: (left + right) / 2,
        midY: edgeY,
        orientation: 'horizontal',
      }
    }
  }

  return null
}

/** Compute center-to-center connector line. */
export function connectorSegment(a: Tile, b: Tile): [number, number, number, number] {
  const ax = a.x + a.w / 2
  const ay = a.y + a.h / 2
  const bx = b.x + b.w / 2
  const by = b.y + b.h / 2
  return [ax, ay, bx, by]
}
