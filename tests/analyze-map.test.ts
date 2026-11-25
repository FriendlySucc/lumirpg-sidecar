import { expect, test } from 'bun:test'
import { applyAnalyzeMap } from '../src/analyze-map.js'
import { sanitizeProposal } from '../src/geometry.js'

function saved() {
  return sanitizeProposal({
    currentLocation: 'The station concourse', notes: ['Keep this cartographer note'],
    maps: {
      local: {
        id: 'station', name: 'Station', currentTileId: 'hall',
        tiles: [
          { id: 'hall', name: 'Main Hall', x: 0, y: 0, status: 'current', features: ['Clock', 'Bell'],
            pins: [{ id: 'pc', name: 'Kris Lyons', isPlayer: true, x: 0.3, y: 0.6, color: '#ffaa22', note: 'Ticket holder' },
              { id: 'porter', name: 'Porter', x: 0.7, y: 0.4, note: 'On shift' }], connections: ['steps', 'kiosk'] },
          { id: 'steps', name: 'Upper Steps', x: 0, y: 0, floor: 2, features: ['Landing'], pins: [{ id: 'clerk', name: 'Clerk' }] },
          { id: 'kiosk', name: 'Kiosk', x: 10, y: 0, kind: 'shop' },
        ], roads: [{ from: 'hall', to: 'steps', kind: 'stairs', label: 'North stair' }],
      },
      region: { id: 'county', name: 'County', currentTileId: 'town', tiles: [
        { id: 'town', name: 'Town', status: 'current', pins: [{ id: 'pc', name: 'Kris Lyons', isPlayer: true }] },
      ] },
      world: { id: 'coast', name: 'Coast', tiles: [{ id: 'island', name: 'Island' }] },
    },
  }, 'test-chat', 'test-message', 3)
}

test('the canonical empty mapPatch returns the exact saved state', () => {
  const previous = saved()
  expect(applyAnalyzeMap(previous, {})).toBe(previous)
})

const playerMove = { scale: 'local', name: 'Kris Lyons', toTile: 'steps' }

test('crossing a tile moves only the player pin, current marker and active floor on that scale', () => {
  const previous = saved()
  const before = structuredClone(previous)
  const expected = structuredClone(previous)
  const local = expected.maps.local
  local.tiles[1].pins.push(local.tiles[0].pins.shift()!)
  local.currentTileId = 'steps'
  local.activeFloor = 2
  local.tiles[0].status = 'visited'
  local.tiles[1].status = 'current'
  expect(applyAnalyzeMap(previous, { movePins: [playerMove] })).toEqual(expected)
  expect(previous).toEqual(before)
})

test('movement inside the same tile is a no-op; an NPC crossing floors does not move the player', () => {
  const previous = saved()
  expect(applyAnalyzeMap(previous, { movePins: [{ ...playerMove, toTile: 'hall' }] })).toBe(previous)
  const expected = structuredClone(previous)
  const [hall, steps] = expected.maps.local.tiles
  steps.pins.push(hall.pins.pop()!)
  expect(applyAnalyzeMap(previous, { movePins: [{ scale: 'local', pinId: 'porter', toTile: 'steps' }] })).toEqual(expected)
})

test('pin selectors must identify one exact saved pin; a stable id disambiguates names', () => {
  const previous = saved()
  const hall = previous.maps.local.tiles[0]
  hall.pins.push({ ...hall.pins[1], id: 'night_porter' })
  for (const move of [
    { name: 'Porter' }, { name: 'Nobody' }, { pinId: 'absent' }, { name: 'Porter', pinId: 'pc' },
    { name: 'porter' }, { name: 'Porter', pinId: 'porter', toTile: 'Upper Steps' },
  ]) {
    expect(() => applyAnalyzeMap(previous, { movePins: [{ scale: 'local', toTile: 'steps', ...move }] })).toThrow()
  }
  const moved = applyAnalyzeMap(previous, { movePins: [{ scale: 'local', name: 'Porter', pinId: 'night_porter', toTile: 'kiosk' }] })
  expect(moved.maps.local.tiles[2].pins).toEqual([hall.pins[2]])
  expect(moved.maps.local.tiles[0].pins).toEqual(hall.pins.slice(0, 2))
})

test('a bad second move rejects the whole batch without modifying the input', () => {
  const previous = saved()
  const before = structuredClone(previous)
  for (const bad of [
    { ...playerMove, pinId: 'pc', toTile: 'kiosk' }, // conflicting writes by two selectors
    { ...playerMove, toTile: 'unknown' }, { ...playerMove, scale: 'district' },
    { scale: 'local', toTile: 'steps' }, { ...playerMove, toTile: null }, { ...playerMove, x: 0 },
  ]) {
    expect(() => applyAnalyzeMap(previous, { movePins: [playerMove, bad] })).toThrow()
    expect(previous).toEqual(before)
  }
})

test('a timeskip can edit existing geometry, connect new nodes, switch maps and then move a saved pin', () => {
  const previous = saved()
  const before = structuredClone(previous)
  const next = applyAnalyzeMap(previous, {
    movePins: [{ ...playerMove, toTile: 'platform' }],
    local: {
      tiles: [
        { id: 'steps', summary: 'Reopened after repairs', w: 15 },
        { id: 'platform', name: 'New Platform', x: 20, y: 0, floor: 3, connections: ['steps'], features: ['Canopy'] },
      ], roads: [{ from: 'platform', to: 'steps', kind: 'transit', label: 'New lift' }],
    },
    region: { tiles: [{ id: 'port', name: 'New Port', connections: ['town'] }] },
    world: { id: 'mainland', name: 'Mainland', currentTileId: 'main_port', tiles: [
      { id: 'main_port', name: 'Main Port', kind: 'settlement', pins: [{ id: 'pc', name: 'Kris Lyons', isPlayer: true }] },
      { id: 'valley', name: 'Valley' },
    ], roads: [{ from: 'main_port', to: 'valley', kind: 'path' }] },
  })
  const [hall, steps, kiosk, platform] = next.maps.local.tiles
  expect(hall).toEqual({ ...before.maps.local.tiles[0], status: 'visited', pins: before.maps.local.tiles[0].pins.slice(1) })
  expect(steps).toEqual({ ...before.maps.local.tiles[1], summary: 'Reopened after repairs', w: 15 })
  expect(kiosk).toEqual(before.maps.local.tiles[2])
  expect(platform).toMatchObject({ id: 'platform', status: 'current', pins: [before.maps.local.tiles[0].pins[0]], connections: ['steps'], features: ['Canopy'] })
  expect(next.maps.local.currentTileId).toBe('platform')
  expect(next.maps.local.activeFloor).toBe(3)
  expect(next.maps.local.roads).toEqual([...before.maps.local.roads, { from: 'platform', to: 'steps', kind: 'transit', label: 'New lift' }])
  expect(next.maps.region.tiles[0]).toEqual(before.maps.region.tiles[0])
  expect(next.maps.region.roads).toEqual([{ from: 'port', to: 'town', kind: 'road' }])
  expect(next.maps.world.id).toBe('mainland')
  expect(next.maps.world.tiles.map(t => t.id)).toEqual(['main_port', 'valley'])
  expect(next.maps.world.tiles[0]).toMatchObject({ status: 'current', pins: [{ id: 'pc', name: 'Kris Lyons', isPlayer: true }] })
  expect(previous).toEqual(before) // old world remains intact for the backend archive
})

test('road edits use unordered endpoint ids and never drop other routes or omitted fields', () => {
  const previous = saved()
  const expected = structuredClone(previous)
  expected.maps.local.roads[0].label = 'Concourse stair'
  expect(applyAnalyzeMap(previous, { local: { roads: [{ from: 'steps', to: 'hall', label: 'Concourse stair' }] } })).toEqual(expected)
  expect(applyAnalyzeMap(previous, { local: { tiles: [], roads: [] } })).toEqual(previous)
})
