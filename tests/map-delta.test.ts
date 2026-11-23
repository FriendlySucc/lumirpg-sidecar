import { expect, test } from 'bun:test'
import { emptyAtlasState, sanitizeProposal } from '../src/geometry.js'
import { applyMapDelta } from '../src/map-delta.js'

test('a partial map update preserves untouched tiles, roads, and properties', () => {
  const previous = sanitizeProposal({
    currentLocation: 'Market',
    maps: { local: {
      id: 'market_local', name: 'Market', currentTileId: 'market',
      tiles: [
        { id: 'market', name: 'Market', kind: 'shop', status: 'current', x: 0, y: 0, w: 10, h: 10, summary: 'Open', features: ['Neon sign'], connections: ['street'] },
        { id: 'street', name: 'Street', kind: 'street', status: 'known', x: 10, y: 0, w: 10, h: 10, summary: 'Busy' },
      ],
      roads: [{ from: 'market', to: 'street', kind: 'path', label: 'Walkway' }],
    } },
  }, 'chat', 'm1', 1, emptyAtlasState('chat'))
  const before = structuredClone(previous)
  const result = applyMapDelta(previous, {
    local: { id: 'market_local', tiles: [{ id: 'market', summary: 'Closing soon' }] },
  })
  expect(result.maps.local.tiles.map(t => t.id)).toEqual(['market', 'street'])
  expect(result.maps.local.tiles[0].summary).toBe('Closing soon')
  expect(result.maps.local.tiles[0].features).toEqual(['Neon sign'])
  expect(result.maps.local.tiles[1]).toEqual(before.maps.local.tiles[1])
  expect(result.maps.local.roads).toEqual(before.maps.local.roads)
  expect(previous).toEqual(before)
})

test('partial road updates preserve other routes and never mutate the old map', () => {
  const previous = sanitizeProposal({ maps: { region: {
    id: 'district', name: 'District', currentTileId: 'a',
    tiles: [
      { id: 'a', name: 'Alpha', x: 0, y: 0, w: 10, h: 10, connections: ['b'] },
      { id: 'b', name: 'Beta', x: 10, y: 0, w: 10, h: 10, connections: ['a','c'] },
      { id: 'c', name: 'Gamma', x: 20, y: 0, w: 10, h: 10, connections: ['b'] },
    ],
    roads: [{ from: 'a', to: 'b', kind: 'road', label: 'Main road' }, { from: 'b', to: 'c', kind: 'path', label: 'Trail' }],
  } } }, 'chat', 'm1', 1)
  const before = structuredClone(previous)
  const result = applyMapDelta(previous, { region: { id: 'district', roads: [{ from:'a', to:'b', label:'Renamed' }] } })
  expect(result.maps.region.roads).toEqual([
    { from: 'a', to: 'b', kind: 'road', label: 'Renamed' },
    { from: 'b', to: 'c', kind: 'path', label: 'Trail' },
  ])
  expect(previous).toEqual(before)
})

test('an incomplete new map cannot replace the existing map', () => {
  const previous = sanitizeProposal({ maps: { local: {
    id: 'one', name: 'Original', tiles: [{ id:'a', name:'Alpha', x:0, y:0, w:10, h:10 }], roads: [],
  } } }, 'chat', 'm1', 1)
  expect(() => applyMapDelta(previous, { local: { id: 'two', name: 'New place', tiles: [{ id:'b' }] } })).toThrow()
  expect(previous.maps.local.id).toBe('one')
  expect(previous.maps.local.tiles[0].name).toBe('Alpha')
})
