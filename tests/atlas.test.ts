import { describe, expect, test } from 'bun:test'
import {
  computeViewBox,
  extractJsonObject,
  findSharedEdge,
  resolveOverlaps,
  sanitizeProposal,
  tilesOverlap,
} from '../src/geometry.js'
import { buildAtlasPrompt } from '../src/prompt.js'
import type { Tile } from '../src/types.js'

describe('LumiAtlas geometry & sanitization', () => {
  test('extractJsonObject handles clean JSON, fenced JSON, and prose wrappers', () => {
    expect(extractJsonObject('{"a": 1}')).toEqual({ a: 1 })
    expect(extractJsonObject('Here is the map:\n```json\n{"currentLocation":"Kabuki"}\n```')).toEqual({
      currentLocation: 'Kabuki',
    })
    expect(extractJsonObject('Notes before {"maps":{"local":{"tiles":[]}}} trailing')).toEqual({
      maps: { local: { tiles: [] } },
    })
    expect(() => extractJsonObject('no json here')).toThrow()
  })

  test('resolveOverlaps separates colliding tiles on the same floor without moving preserved tiles', () => {
    const base: Tile = {
      id: 'lobby',
      name: 'Lobby',
      kind: 'room',
      status: 'current',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      floor: 0,
      sizeLabel: '10 m',
      summary: 'Main lobby',
      features: [],
      pins: [],
      connections: [],
    }
    const colliding: Tile = {
      ...base,
      id: 'office',
      name: 'Office',
      status: 'known',
      x: 5,
      y: 0,
    }
    const upperFloor: Tile = {
      ...base,
      id: 'penthouse',
      name: 'Penthouse',
      floor: 1,
      x: 0,
      y: 0,
    }

    const result = resolveOverlaps([base, colliding, upperFloor], new Set(['lobby']))
    const lobby = result.find((t) => t.id === 'lobby')!
    const office = result.find((t) => t.id === 'office')!
    const penthouse = result.find((t) => t.id === 'penthouse')!

    expect(lobby.x).toBe(0)
    expect(lobby.y).toBe(0)
    expect(tilesOverlap(lobby, office)).toBe(false)
    expect(penthouse.x).toBe(0)
    expect(penthouse.floor).toBe(1)
  })

  test('sanitizeProposal normalizes 3 layers, pins, roads, colors, and physical size markers', () => {
    const raw = {
      currentLocation: 'Kabuki Market — Noodle Counter',
      notes: ['Fleshed out 6 connected stalls around Kabuki Market'],
      maps: {
        local: {
          id: 'kabuki_market',
          name: 'Kabuki Market',
          currentTileId: 'noodle_counter',
          tiles: [
            {
              id: 'noodle_counter',
              name: 'Noodle Counter',
              kind: 'shop',
              status: 'current',
              x: 0,
              y: 0,
              w: 10,
              h: 10,
              sizeLabel: '10 m',
              summary: 'Steam rises from synth-broth pots.',
              features: ['Neon menu board', 'Stools along the alley'],
              connections: ['cyber_stall', 'back_office'],
              pins: [
                { name: 'Kris', x: 5, y: 5, isPlayer: true, note: 'eating' },
                { name: 'Vendor', x: 5, y: 5, note: 'behind counter' },
              ],
            },
            {
              id: 'cyber_stall',
              name: 'Chrome & Scrap Stall',
              kind: 'shop',
              status: 'known',
              x: 10,
              y: 0,
              w: 10,
              h: 10,
              sizeLabel: '10 m',
              summary: 'Used optics and scavenged cables.',
              features: ['Glass display case'],
              connections: ['noodle_counter'],
              pins: [],
            },
            {
              id: 'back_office',
              name: 'Locked Back Room',
              kind: 'room',
              status: 'locked',
              x: 0,
              y: -10,
              w: 10,
              h: 10,
              summary: 'Heavy steel door with a keypad.',
              features: ['Keypad lock'],
              connections: ['noodle_counter'],
              pins: [],
            },
          ],
          roads: [{ from: 'noodle_counter', to: 'cyber_stall', kind: 'door' }],
        },
        region: {
          id: 'watson_region',
          name: 'Watson',
          currentTileId: 'kabuki',
          tiles: [
            {
              id: 'kabuki',
              name: 'Kabuki',
              kind: 'district',
              status: 'current',
              x: 0,
              y: 0,
              w: 20,
              h: 15,
              sizeLabel: '1.8 km',
              color: '#8b5a7c',
              summary: 'Dense neon alleys and black markets.',
              features: ['Braindance Paradise', 'Kabuki Roundabout'],
              connections: ['little_china'],
              pins: [
                { name: 'Kris', x: 0.4, y: 0.5, isPlayer: true },
                { name: 'Jessie', x: 0.7, y: 0.6, note: 'Braindance Paradise' },
              ],
            },
            {
              id: 'little_china',
              name: 'Little China',
              kind: 'district',
              status: 'known',
              x: -20,
              y: 0,
              w: 20,
              h: 15,
              sizeLabel: '2.4 km',
              color: '#4e7a8c',
              summary: 'Crowded megabuildings and clinics.',
              features: ['Megabuilding H10'],
              connections: ['kabuki'],
              pins: [],
            },
          ],
          roads: [{ from: 'kabuki', to: 'little_china', kind: 'road', label: 'Kabuki Overpass' }],
        },
        world: {
          id: 'night_city_world',
          name: 'Night City',
          currentTileId: 'watson',
          tiles: [
            {
              id: 'watson',
              name: 'Watson',
              kind: 'region',
              status: 'current',
              x: 0,
              y: -15,
              w: 25,
              h: 20,
              sizeLabel: '8 km',
              color: '#8b5a7c',
              summary: 'Northern industrial and residential district.',
              features: ['Kabuki', 'Northside'],
              connections: ['westbrook'],
              pins: [
                { name: 'Kris', x: 0.5, y: 0.5, isPlayer: true },
                { name: 'Jessie', x: 0.7, y: 0.6, note: 'Kabuki' },
              ],
            },
            {
              id: 'westbrook',
              name: 'Westbrook',
              kind: 'region',
              status: 'known',
              x: 25,
              y: -15,
              w: 25,
              h: 20,
              sizeLabel: '10 km',
              color: '#5c7c5a',
              summary: 'Japantown and Charter Hill.',
              features: ['Jig-Jig Street'],
              connections: ['watson'],
              pins: [],
            },
          ],
        },
      },
    }

    const state = sanitizeProposal(raw, 'chat_1', 'msg_9', 9)
    expect(state.maps.local.tiles.length).toBe(3)
    expect(state.maps.local.currentTileId).toBe('noodle_counter')
    // Overlapping pins at (5,5) get normalized and spread apart
    const noodlePins = state.maps.local.tiles[0].pins
    expect(noodlePins.length).toBe(2)
    expect(Math.hypot(noodlePins[0].x - noodlePins[1].x, noodlePins[0].y - noodlePins[1].y)).toBeGreaterThanOrEqual(0.1)

    // Roads auto-populated from connections too
    expect(state.maps.local.roads.length).toBe(2)
    expect(state.maps.world.roads.length).toBe(1)

    // Shared edge detection works between touching tiles
    const edge = findSharedEdge(state.maps.local.tiles[0], state.maps.local.tiles[1])
    expect(edge).not.toBeNull()
    expect(edge?.orientation).toBe('vertical')
    expect(edge?.midX).toBe(10)

    // ViewBox wraps tiles with padding
    const vb = computeViewBox(state.maps.local.tiles, 5)
    expect(vb.x).toBe(-5)
    expect(vb.y).toBe(-15)
    expect(vb.w).toBeGreaterThanOrEqual(30)
  })

  test('sanitizeProposal auto-scales tiny 1-4 unit tile grids so proportions and shared edges survive', () => {
    const state = sanitizeProposal({
      maps: {
        world: {
          id: 'dicathen_world',
          name: 'Dicathen',
          tiles: [
            { id: 'heartland', name: 'Dicathen Heartland', x: 0, y: 0, w: 3, h: 2, status: 'current' },
            { id: 'border', name: 'Wyrmathen Border', x: 3, y: 0, w: 2, h: 2, status: 'known' },
          ],
        },
      },
    }, 'chat_u', 'm1', 1)
    const [heart, border] = state.maps.world.tiles
    expect(heart.w).toBe(30)
    expect(heart.h).toBe(20)
    expect(border.x).toBe(30)
    expect(border.w).toBe(20)
    expect(findSharedEdge(heart, border)).not.toBeNull()
  })

  test('buildAtlasPrompt embeds initialization rules and prior state when updating', () => {
    const prompt = buildAtlasPrompt(
      [{ role: 'assistant', content: 'You step into Kabuki Market under flickering neon.' }],
      null,
      'rebuild',
    )
    expect(prompt).toContain('LOCAL LAYER (Initialization Protocol')
    expect(prompt).toContain('MULTI-SCALE CHARACTER PINS')
    expect(prompt).toContain('Kabuki Market')
  })
})
