import { emptyLayer, isValidHexColor, resolveOverlaps, SCALES, slugify } from './geometry.js'
import type { AtlasState, MapLayer, Pin, Road, Scale, Tile } from './types.js'

const KINDS = ['room', 'hallway', 'street', 'shop', 'landmark', 'settlement', 'district', 'region', 'kingdom', 'mountain', 'water', 'forest', 'desert', 'marsh', 'ruin', 'exit', 'other'] as const
const STATUSES = ['current', 'visited', 'known', 'rumored', 'locked', 'unexplored'] as const
const ROADS = ['road', 'path', 'door', 'stairs', 'transit', 'sea_route'] as const
const TILE_FIELDS = ['id', 'name', 'kind', 'status', 'x', 'y', 'w', 'h', 'floor', 'sizeLabel', 'color', 'summary']
const MOVE_FIELDS = ['scale', 'name', 'pinId', 'toTile']

export const ANALYZE_MAP_FORMAT = `Read atlas.maps[scale]: .id is the active map; .tiles[].id identifies a tile; .tiles[].pins[] gives its occupants (id, name, isPlayer); .roads[] uses endpoint tile IDs. Use exact saved IDs/names, not display labels for tile IDs.
Write mapPatch:{} for no map change. Only keys: movePins, local, region, world. For a tile crossing use {"movePins":[{"scale":"local","name":"Kris Lyons","toTile":"stable_id"}]}. One move per saved pin per scale; pinId may replace or disambiguate name. toTile may be added in this patch. Never rebuild pins or move other scales by inference. Player moves set currentTileId, activeFloor and tile status automatically.
Each scale is a sparse {id?,name?,currentTileId?,activeFloor?,tiles?:[tile],roads?:[road]}. Omit id or reuse it for the active map. A different id starts a new map: give its name and at least one named tile. New IDs are lowercase underscore slugs (max 64); never rename IDs. Missing fields/rows stay. No deletes, nulls or replacements.
Tile: {id,name?,kind?,status?,x?,y?,w?,h?,floor?,sizeLabel?,color?,summary?}; new tiles require name. x,y = multiples of 5 in -120..120, w,h = 5..60 by 5; local floor integer -10..40, otherwise 0. kind: ${KINDS.join('|')}; status: ${STATUSES.join('|')}. New tile only: features:[text], connections:[tileId], pins:[pin]. Existing tile additions only: addFeatures, addConnections, addPins (same array types). Pin: {id,name,x?,y?,note?,color?,isPlayer?}; x,y in 0..1, isPlayer boolean; colors #RRGGBB. Road: {from,to,kind?,label?}; upsert by distinct unordered tile IDs, kind: ${ROADS.join('|')}. Reference only tiles on the resulting map. Omit unchanged geometry.`

type Row = Record<string, unknown>

function invalid(path: string, reason: string): never {
  throw new Error(`${path}: ${reason}`)
}

function object(value: unknown, keys: readonly string[], path: string): Row {
  if (!value || typeof value !== 'object' || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) {
    invalid(path, 'expected a JSON object')
  }
  for (const key of Object.keys(value)) if (!keys.includes(key)) invalid(`${path}.${key}`, 'unsupported field')
  return value as Row
}

function list(value: unknown, path: string): unknown[] {
  return Array.isArray(value) ? value : invalid(path, 'expected an array')
}

function text(value: unknown, path: string): string {
  return typeof value === 'string' && value.trim() ? value : invalid(path, 'expected a nonempty string')
}

function choice<T extends string>(value: unknown, options: readonly T[], path: string): T {
  return options.find(option => option === value) ?? invalid(path, `expected ${options.join('|')}`)
}

function one<T>(items: T[], path: string): T {
  if (items.length !== 1) invalid(path, items.length ? 'ambiguous target' : 'unknown target')
  return items[0]
}

function newId(value: string, path: string): string {
  return slugify(value, '') === value ? value : invalid(path, 'expected a stable lowercase slug (max 64)')
}

function number(value: unknown, min: number, max: number, step: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (step && value % step !== 0)) {
    invalid(path, `expected ${min}..${max}${step ? ` in steps of ${step}` : ''}`)
  }
  return value
}

function color(value: unknown, path: string): string {
  return isValidHexColor(value) && value === value.trim() ? value : invalid(path, 'expected #RRGGBB')
}

function floor(value: unknown, scale: Scale, path: string): number {
  return number(value, scale === 'local' ? -10 : 0, scale === 'local' ? 40 : 0, 1, path)
}

function newPin(raw: unknown, path: string): Pin {
  const row = object(raw, ['id', 'name', 'x', 'y', 'note', 'color', 'isPlayer'], path)
  const pin: Pin = {
    id: newId(text(row.id, `${path}.id`), `${path}.id`), name: text(row.name, `${path}.name`),
    x: 'x' in row ? number(row.x, 0, 1, 0, `${path}.x`) : 0.5,
    y: 'y' in row ? number(row.y, 0, 1, 0, `${path}.y`) : 0.5,
  }
  if ('note' in row) pin.note = text(row.note, `${path}.note`)
  if ('color' in row) pin.color = color(row.color, `${path}.color`)
  if ('isPlayer' in row) {
    if (typeof row.isPlayer !== 'boolean') invalid(`${path}.isPlayer`, 'expected a boolean')
    pin.isPlayer = row.isPlayer
  }
  return pin
}

// Keep the previous map intact for archiving, and never feed a merged layer through
// sanitizeLayer: it caps collections, rewrites identifiers and repositions old pins.
function newTile(id: string, name: string, scale: Scale, i: number): Tile {
  const size = scale === 'local' ? 10 : 15
  return { id, name, kind: scale === 'local' ? 'room' : scale === 'region' ? 'district' : 'region', status: 'known',
    x: (i % 4) * 15 - 30, y: Math.min(120, Math.floor(i / 4) * 15 - 30), w: size, h: size, floor: 0,
    summary: '', sizeLabel: '', features: [], connections: [], pins: [] }
}

// A focus claim can come from a layer pointer, tile status, new player or player
// crossing. Validate them together rather than letting JSON property order decide.
interface Focus { id?: string; activeFloor?: number; refloor?: boolean; statuses: Map<string, Tile['status']> }
function pointAt(focus: Focus, id: string, path: string): void {
  if (focus.id !== undefined && focus.id !== id) invalid(path, `conflicting current tiles: ${focus.id}, ${id}`)
  focus.id = id
}

function editTile(row: Row, old: Tile | undefined, id: string, scale: Scale, i: number, path: string): Tile {
  const tile = old ? { ...old } : newTile(newId(id, `${path}.id`), text(row.name, `${path}.name`), scale, i)
  for (const key of ['name', 'summary', 'sizeLabel'] as const) if (key in row) tile[key] = text(row[key], `${path}.${key}`)
  for (const key of ['x', 'y'] as const) if (key in row) tile[key] = number(row[key], -120, 120, 5, `${path}.${key}`)
  for (const key of ['w', 'h'] as const) if (key in row) tile[key] = number(row[key], 5, 60, 5, `${path}.${key}`)
  if ('color' in row) tile.color = color(row.color, `${path}.color`)
  if ('kind' in row) tile.kind = choice(row.kind, KINDS, `${path}.kind`)
  if ('status' in row) tile.status = choice(row.status, STATUSES, `${path}.status`)
  if ('floor' in row) tile.floor = floor(row.floor, scale, `${path}.floor`)
  for (const [key, addKey] of [['features', 'addFeatures'], ['connections', 'addConnections'], ['pins', 'addPins']] as const) {
    const field = old ? addKey : key
    const forbidden = old ? key : addKey
    if (forbidden in row) invalid(`${path}.${forbidden}`, `use ${field} on ${old ? 'an existing' : 'a new'} tile`)
    if (!(field in row)) continue
    const values = list(row[field], `${path}.${field}`)
    if (key === 'pins') tile.pins = tile.pins.concat(Array.from(values, (v, j) => newPin(v, `${path}.${field}[${j}]`)))
    else {
      const seen = new Set(tile[key])
      tile[key] = tile[key].concat(Array.from(values, (v, j) => {
        const value = text(v, `${path}.${field}[${j}]`)
        if (seen.has(value)) invalid(`${path}.${field}`, `duplicate value: ${value}`)
        seen.add(value)
        return value
      }))
    }
  }
  return tile
}

function roadKey(a: string, b: string): string { return JSON.stringify(a < b ? [a, b] : [b, a]) }

function editLayer(old: MapLayer, raw: unknown, scale: Scale, focus: Focus): MapLayer {
  const path = `mapPatch.${scale}`
  const patch = object(raw, ['id', 'name', 'currentTileId', 'activeFloor', 'tiles', 'roads'], path)
  const id = 'id' in patch ? text(patch.id, `${path}.id`) : old.id
  const fresh = id !== old.id
  const base = fresh ? { ...emptyLayer(scale), id: newId(id, `${path}.id`) } : old
  const name = fresh || 'name' in patch ? text(patch.name, `${path}.name`) : base.name
  if ('currentTileId' in patch) pointAt(focus, text(patch.currentTileId, `${path}.currentTileId`), path)
  if ('activeFloor' in patch) focus.activeFloor = floor(patch.activeFloor, scale, `${path}.activeFloor`)

  const tiles = base.tiles.slice(), roads = base.roads.slice()
  const touched = new Set<string>(), pinIds = new Set(tiles.flatMap(tile => tile.pins.map(p => p.id)))
  const links: { from: string; to: string }[] = []
  const rows = 'tiles' in patch ? list(patch.tiles, `${path}.tiles`) : []
  if (fresh && !rows.length) invalid(path, 'a new map needs named tiles')
  for (const [i, rawTile] of rows.entries()) {
    const p = `${path}.tiles[${i}]`
    const row = object(rawTile, [...TILE_FIELDS, 'features', 'pins', 'connections', 'addFeatures', 'addPins', 'addConnections'], p)
    const tileId = text(row.id, `${p}.id`)
    if (touched.has(tileId)) invalid(p, `duplicate tile patch: ${tileId}`)
    touched.add(tileId)
    const matches = tiles.filter(t => t.id === tileId)
    const before = matches.length ? one(matches, `${p}.id (${tileId})`) : undefined
    const tile = editTile(row, before, tileId, scale, tiles.length, p)
    if (before) tiles[tiles.indexOf(before)] = tile; else tiles.push(tile)
    for (const pin of tile.pins.slice(before?.pins.length ?? 0)) {
      if (pinIds.has(pin.id)) invalid(p, `pin id already on this map: ${pin.id}; use movePins to move it`)
      pinIds.add(pin.id)
      if (pin.isPlayer) pointAt(focus, tile.id, p)
    }
    for (const to of tile.connections.slice(before?.connections.length ?? 0)) links.push({ from: tile.id, to })
    if ('status' in row) {
      focus.statuses.set(tile.id, tile.status)
      if (tile.status === 'current') pointAt(focus, tile.id, p)
    }
    if ('floor' in row && tile.id === base.currentTileId) focus.refloor = true
  }

  const roadPatches = 'roads' in patch ? list(patch.roads, `${path}.roads`) : []
  const touchedRoads = new Set<string>()
  function upsertRoad(from: string, to: string, row: Row, p: string, implied: boolean) {
    if (from === to) invalid(p, 'a route needs two different tile IDs')
    for (const id of [from, to]) one(tiles.filter(t => t.id === id), `${p} (${id})`)
    const key = roadKey(from, to)
    const matches = roads.filter(r => roadKey(r.from, r.to) === key)
    const before = matches.length ? one(matches, `${p} (${from}, ${to})`) : undefined
    if (implied && before) return
    if (!implied && touchedRoads.has(key)) invalid(p, `duplicate road patch: ${from}, ${to}`)
    touchedRoads.add(key)
    const road: Road = before ? { ...before } : { from, to, kind: scale === 'local' ? 'door' : 'road' }
    if ('kind' in row) road.kind = choice(row.kind, ROADS, `${p}.kind`)
    if ('label' in row) road.label = text(row.label, `${p}.label`)
    if (before) roads[roads.indexOf(before)] = road; else roads.push(road)
  }
  for (const [i, rawRoad] of roadPatches.entries()) {
    const p = `${path}.roads[${i}]`
    const row = object(rawRoad, ['from', 'to', 'kind', 'label'], p)
    upsertRoad(text(row.from, `${p}.from`), text(row.to, `${p}.to`), row, p, false)
  }
  for (const { from, to } of links) upsertRoad(from, to, {}, `${path}.connections`, true)

  if (tiles.length > base.tiles.length) {
    const placed = resolveOverlaps(tiles, new Set(base.tiles.map(t => t.id)))
    for (let i = base.tiles.length; i < tiles.length; i++) tiles[i] = placed[i]
  }
  return { ...base, name, tiles, roads }
}

function movePin(layer: MapLayer, move: Row, moved: Set<Pin>, path: string, focus: Focus): MapLayer {
  const id = 'pinId' in move ? text(move.pinId, `${path}.pinId`) : undefined
  const name = 'name' in move ? text(move.name, `${path}.name`) : undefined
  if (!id && !name) invalid(path, 'supply name or pinId')
  const toId = text(move.toTile, `${path}.toTile`)
  const to = one(layer.tiles.filter(t => t.id === toId), `${path}.toTile (${toId})`)
  const matches: { tile: Tile; pin: Pin }[] = []
  for (const tile of layer.tiles) for (const pin of tile.pins) {
    if ((!id || pin.id === id) && (!name || pin.name === name)) matches.push({ tile, pin })
  }
  const { tile: from, pin } = one(matches, `${path} (${id ?? name})`)
  if (moved.has(pin)) invalid(path, 'two moves for the same pin')
  moved.add(pin)
  if (pin.isPlayer) pointAt(focus, to.id, path)
  if (from === to) return layer

  const tiles = layer.tiles.map(tile => {
    if (tile === to) return { ...to, pins: [...to.pins, pin], status: pin.isPlayer ? 'current' as const : to.status }
    if (tile === from) return { ...from, pins: from.pins.filter(p => p !== pin),
      status: pin.isPlayer && from.status === 'current' ? 'visited' as const : from.status }
    return tile
  })
  return pin.isPlayer ? { ...layer, tiles, currentTileId: to.id, activeFloor: layer.scale === 'local' ? to.floor : 0 } : { ...layer, tiles }
}

/** Apply only a normal Analyze diff. No writes to the input or the legacy Rebuild path. */
export function applyAnalyzeMap(previous: AtlasState, mapPatch: unknown): AtlasState {
  const patch = object(mapPatch, [...SCALES, 'movePins'], 'mapPatch')
  if (!Object.keys(patch).length) return previous
  const maps = { ...previous.maps }
  const makeFocus = (): Focus => ({statuses:new Map()})
  const focus = {local:makeFocus(), region:makeFocus(), world:makeFocus()}
  for (const scale of SCALES) if (Object.hasOwn(patch, scale)) maps[scale] = editLayer(maps[scale], patch[scale], scale, focus[scale])
  const moved: Record<Scale, Set<Pin>> = { local: new Set(), region: new Set(), world: new Set() }
  const moves = Object.hasOwn(patch, 'movePins') ? list(patch.movePins, 'mapPatch.movePins') : []
  for (const [i, raw] of moves.entries()) {
    const path = `mapPatch.movePins[${i}]`
    const move = object(raw, MOVE_FIELDS, path)
    const scale = choice(move.scale, SCALES, `${path}.scale`)
    maps[scale] = movePin(maps[scale], move, moved[scale], path, focus[scale])
  }
  for (const scale of SCALES) {
    const f = focus[scale], layer = maps[scale]
    if (layer === previous.maps[scale]) continue
    const id = f.id ?? layer.currentTileId
    if (id === null) {
      if (f.activeFloor !== undefined) maps[scale] = {...layer, activeFloor:f.activeFloor}
      continue
    }
    const current = one(layer.tiles.filter(t => t.id === id), `mapPatch.${scale}.currentTileId`)
    if (f.id !== undefined || f.refloor || f.activeFloor !== undefined || f.statuses.has(id)) {
      const activeFloor = scale === 'local' ? current.floor : 0
      if ((f.activeFloor !== undefined && f.activeFloor !== activeFloor) || (f.statuses.has(id) && f.statuses.get(id) !== 'current')) invalid(`mapPatch.${scale}`, 'conflicting current tile status/floor')
      if (layer.tiles.some(t => t.pins.some(p => p.isPlayer) && t.id !== id)) invalid(`mapPatch.${scale}`, 'current tile conflicts with player pin; move the pin instead')
      maps[scale] = {...layer,currentTileId:id,activeFloor,tiles:layer.tiles.map(t => t.id === id && t.status !== 'current' ? {...t,status:'current'} : t.id !== id && t.status === 'current' ? {...t,status:'visited'} : t)}
    }
  }
  return SCALES.some(scale => maps[scale] !== previous.maps[scale]) ? { ...previous, maps } : previous
}
