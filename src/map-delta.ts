import { sanitizeLayer } from './geometry.js'
import type { AtlasState, Scale, Tile } from './types.js'

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Merge map updates by stable tile id, keeping omitted content untouched. */
export function applyMapDelta(previous: AtlasState, delta: unknown): AtlasState {
  const maps = object(delta)
  if (!maps) return previous
  const next: AtlasState = { ...previous, maps: { ...previous.maps } }
  for (const scale of ['local', 'region', 'world'] as Scale[]) {
    const patch = object(maps[scale])
    if (!patch) continue
    const old = previous.maps[scale]
    const sameMap = !patch.id || patch.id === old.id
    const rows = Array.isArray(patch.tiles) ? patch.tiles : []
    const oldTiles: Tile[] = sameMap ? old.tiles : []
    const merged: Record<string, unknown>[] = oldTiles.map(t => ({ ...t }))
    for (const item of rows) {
      const row = object(item)
      if (!row || typeof row.id !== 'string' || !row.id) throw new Error(`Invalid ${scale} tile patch`)
      const index = merged.findIndex(t => t.id === row.id)
      if (index >= 0) merged[index] = { ...merged[index], ...row }
      else {
        if (typeof row.name !== 'string' || !row.name.trim()) throw new Error(`New ${scale} tile requires a name`)
        merged.push(row)
      }
    }
    if (!sameMap && !merged.length) throw new Error(`New ${scale} map has no tiles`)
    const roads: Record<string, unknown>[] = sameMap ? old.roads.map(road => ({ ...road })) : []
    for (const item of Array.isArray(patch.roads) ? patch.roads : []) {
      const road = object(item)
      if (!road || typeof road.from !== 'string' || typeof road.to !== 'string' || !road.from || !road.to || road.from === road.to) {
        throw new Error(`Invalid ${scale} road patch`)
      }
      const index = roads.findIndex(r => (r.from === road.from && r.to === road.to) || (r.from === road.to && r.to === road.from))
      if (index >= 0) roads[index] = { ...roads[index], ...road }
      else roads.push(road)
    }
    const raw = {
      ...(sameMap ? old : {}),
      ...patch,
      tiles: merged,
      roads,
    }
    next.maps[scale] = sanitizeLayer(raw, scale, sameMap ? old : undefined)
  }
  return next
}
