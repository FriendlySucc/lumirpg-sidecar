import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import type { AtlasState, BackendToFrontendMessage } from '../src/types.js'
import { setup } from '../src/frontend.js'

function makeSampleState(chatId = 'chat_abc'): AtlasState {
  return {
    version: 1,
    chatId,
    updatedAt: '2026-11-23T00:00:00.000Z',
    analyzedMessageId: 'msg_10',
    analyzedMessageCount: 10,
    stale: false,
    staleReason: '',
    currentLocation: 'Kabuki Noodle Counter',
    notes: ['Initialized Kabuki market hub.'],
    maps: {
      local: {
        id: 'kabuki_market',
        name: 'Kabuki Market',
        scale: 'local',
        currentTileId: 'noodle_counter',
        activeFloor: 0,
        tiles: [
          {
            id: 'noodle_counter',
            name: 'Noodle Counter',
            kind: 'shop',
            status: 'current',
            x: 0,
            y: 0,
            w: 15,
            h: 10,
            floor: 0,
            sizeLabel: '15 m',
            summary: 'Steaming synth-ramen stall beneath a pink neon awning.',
            features: ['Plastic stools', 'Back service alley'],
            pins: [{ id: 'player', name: 'Kris', x: 0.4, y: 0.5, note: 'eating', isPlayer: true }],
            connections: ['arcade_walkway'],
          },
          {
            id: 'arcade_walkway',
            name: 'Arcade Walkway',
            kind: 'street',
            status: 'known',
            x: 15,
            y: 0,
            w: 15,
            h: 10,
            floor: 0,
            sizeLabel: '25 m',
            summary: 'Crowded pedestrian corridor lined with pachinko parlors.',
            features: ['Security camera', 'Vending alcove'],
            pins: [],
            connections: ['noodle_counter'],
          },
        ],
        roads: [{ from: 'noodle_counter', to: 'arcade_walkway', kind: 'door' }],
      },
      region: {
        id: 'watson_region',
        name: 'Watson',
        scale: 'region',
        currentTileId: 'kabuki',
        activeFloor: 0,
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
            floor: 0,
            sizeLabel: '1.8 km',
            color: '#8b5a7c',
            summary: 'Dense bazaar sub-district.',
            features: ['Roundabout market'],
            pins: [
              { id: 'player', name: 'Kris', x: 0.35, y: 0.5, isPlayer: true },
              { id: 'jessie', name: 'Jessie', x: 0.7, y: 0.5, note: 'Braindance Paradise' },
            ],
            connections: ['little_china'],
          },
          {
            id: 'little_china',
            name: 'Little China',
            kind: 'district',
            status: 'known',
            x: 20,
            y: 0,
            w: 20,
            h: 15,
            floor: 0,
            sizeLabel: '2.4 km',
            color: '#4e7a8c',
            summary: 'Megabuilding H10 and Viktor clinic.',
            features: ['Megabuilding H10'],
            pins: [],
            connections: ['kabuki'],
          },
        ],
        roads: [{ from: 'kabuki', to: 'little_china', kind: 'road', label: 'Martin St' }],
      },
      world: {
        id: 'night_city_world',
        name: 'Night City',
        scale: 'world',
        currentTileId: 'watson',
        activeFloor: 0,
        tiles: [
          {
            id: 'watson',
            name: 'Watson',
            kind: 'region',
            status: 'current',
            x: 0,
            y: 0,
            w: 25,
            h: 20,
            floor: 0,
            sizeLabel: '8 km',
            color: '#8b5a7c',
            summary: 'Northern industrial and residential district.',
            features: ['Kabuki', 'Northside'],
            pins: [
              { id: 'player', name: 'Kris', x: 0.4, y: 0.5, isPlayer: true },
              { id: 'jessie', name: 'Jessie', x: 0.72, y: 0.6, note: 'Kabuki' },
            ],
            connections: ['westbrook'],
          },
          {
            id: 'westbrook',
            name: 'Westbrook',
            kind: 'region',
            status: 'known',
            x: 25,
            y: 0,
            w: 25,
            h: 20,
            floor: 0,
            sizeLabel: '10 km',
            color: '#5c7c5a',
            summary: 'Japantown and Charter Hill.',
            features: ['Jig-Jig Street'],
            pins: [],
            connections: ['watson'],
          },
        ],
        roads: [{ from: 'watson', to: 'westbrook', kind: 'road' }],
      },
    },
  }
}

function createMockHost(doc: Document) {
  const tabRoot = doc.createElement('div')
  doc.body.appendChild(tabRoot)

  const sent: unknown[] = []
  const backendListeners = new Set<(payload: unknown) => void>()
  const eventListeners = new Map<string, Set<(payload: unknown) => void>>()
  const activateListeners = new Set<() => void>()
  let badge: string | null = null
  let styleRemoved = false
  let tabDestroyed = false
  let uuidCalls = 0

  const ctx = {
    host: {
      descriptorVersion: 1,
      lumiverseVersion: '1.3.0',
      capabilities: { 'frontend-uuid-v1': 1 },
      extensionInstallationId: 'inst_1',
    },
    uuid: {
      v4: () => `uuid-v4-${++uuidCalls}`,
      v7: () => `uuid-v7-${++uuidCalls}`,
    },
    dom: {
      addStyle: (css: string) => {
        const style = doc.createElement('style')
        style.textContent = css
        doc.head.appendChild(style)
        return () => {
          styleRemoved = true
          style.remove()
        }
      },
    },
    ui: {
      registerDrawerTab: () => ({
        root: tabRoot,
        tabId: 'atlas',
        setTitle: () => {},
        setShortName: () => {},
        setBadge: (text: string | null) => {
          badge = text
        },
        activate: () => {},
        destroy: () => {
          tabDestroyed = true
          tabRoot.replaceChildren()
        },
        onActivate: (fn: () => void) => {
          activateListeners.add(fn)
          return () => activateListeners.delete(fn)
        },
      }),
    },
    events: {
      on: (event: string, fn: (payload: unknown) => void) => {
        let set = eventListeners.get(event)
        if (!set) {
          set = new Set()
          eventListeners.set(event, set)
        }
        set.add(fn)
        return () => set!.delete(fn)
      },
      emit: () => {},
    },
    getActiveChat: () => ({ chatId: 'chat_abc', characterId: 'char_1' }),
    sendToBackend: (payload: unknown) => {
      sent.push(payload)
    },
    onBackendMessage: (fn: (payload: unknown) => void) => {
      backendListeners.add(fn)
      return () => backendListeners.delete(fn)
    },
  }

  return {
    ctx,
    tabRoot,
    sent,
    emitBackend: (msg: BackendToFrontendMessage) => {
      for (const fn of backendListeners) fn(msg)
    },
    emitEvent: (event: string, payload: unknown) => {
      for (const fn of eventListeners.get(event) ?? []) fn(payload)
    },
    getBadge: () => badge,
    isStyleRemoved: () => styleRemoved,
    isTabDestroyed: () => tabDestroyed,
    getUuidCalls: () => uuidCalls,
    listenerCount: () => backendListeners.size + (eventListeners.get('CHAT_SWITCHED')?.size ?? 0) + activateListeners.size,
  }
}

describe('LumiAtlas frontend host lifecycle', () => {
  let win: Window
  let prevDocument: unknown
  let prevWindow: unknown

  beforeEach(() => {
    win = new Window()
    prevDocument = (globalThis as Record<string, unknown>).document
    prevWindow = (globalThis as Record<string, unknown>).window
    ;(globalThis as Record<string, unknown>).document = win.document
    ;(globalThis as Record<string, unknown>).window = win
  })

  afterEach(() => {
    ;(globalThis as Record<string, unknown>).document = prevDocument
    ;(globalThis as Record<string, unknown>).window = prevWindow
    win.close()
  })

  test('mounts, uses ctx.uuid.v4 for init, renders 3 scales, switches chat, and cleans up cleanly', () => {
    const host = createMockHost(win.document as unknown as Document)
    const teardown = setup(host.ctx as unknown as Parameters<typeof setup>[0])

    // Sent initial init message with ctx.uuid.v4()
    expect(host.getUuidCalls()).toBeGreaterThanOrEqual(1)
    expect(host.sent.length).toBe(1)
    const initReq = host.sent[0] as { type: string; requestId: string; chatId: string }
    expect(initReq.type).toBe('init')
    expect(initReq.requestId).toBe('uuid-v4-1')
    expect(initReq.chatId).toBe('chat_abc')

    // Push init payload with sample 3-layer Atlas + an archived local zone
    host.emitBackend({
      type: 'init',
      requestId: initReq.requestId,
      activeChatId: 'chat_abc',
      config: { enabled: true, autoUpdate: true, connectionId: 'conn_terra', reasoningMode: 'inherit' },
      connections: [{ id: 'conn_terra', name: 'cheap', model: 'gpt-6.1-terra', provider: 'custom' }],
      state: makeSampleState('chat_abc'),
      archives: {
        local: [
          {
            id: 'apartment_local',
            name: 'Kris Apartment',
            scale: 'local',
            currentTileId: 'bedroom',
            activeFloor: 0,
            tiles: [
              {
                id: 'bedroom',
                name: 'Bedroom',
                kind: 'room',
                status: 'visited',
                x: 0,
                y: 0,
                w: 10,
                h: 10,
                floor: 0,
                sizeLabel: '10 m',
                summary: 'Small apartment bedroom.',
                features: ['Bunk'],
                pins: [],
                connections: [],
              },
            ],
            roads: [],
          },
        ],
        region: [],
        world: [],
      },
      busy: false,
      statusMessage: 'Atlas ready.',
      error: null,
    })

    // Empty overlay is hidden once tiles render
    const emptyOverlay = host.tabRoot.querySelector('.la-empty-overlay') as HTMLElement
    expect(emptyOverlay.hidden).toBe(true)

    // Local tiles rendered in SVG
    const localTiles = host.tabRoot.querySelectorAll('.la-tile-group')
    expect(localTiles.length).toBe(2)
    expect(host.tabRoot.textContent).toContain('Noodle Counter')
    expect(host.tabRoot.textContent).toContain('Arcade Walkway')

    // Local tileset dropdown lists current + archived zone and switches cleanly
    const layerSelect = host.tabRoot.querySelector('.la-layer-select') as HTMLSelectElement
    expect(layerSelect.options.length).toBe(2)
    layerSelect.value = 'apartment_local'
    layerSelect.dispatchEvent(new win.Event('change') as unknown as Event)
    expect(host.tabRoot.textContent).toContain('Bedroom')
    layerSelect.value = 'kabuki_market_local'
    layerSelect.dispatchEvent(new win.Event('change') as unknown as Event)

    // Live stream thinking preview renders reasoning tokens
    host.emitBackend({
      type: 'stream',
      chatId: 'chat_abc',
      phase: 'thinking',
      reasoning: 'Charting Kabuki Market exits and pins...',
      outputChars: 0,
      outputTail: '',
    })
    const thinkingBox = host.tabRoot.querySelector('.la-thinking') as HTMLElement
    expect(thinkingBox.hidden).toBe(false)
    expect(thinkingBox.textContent).toContain('Charting Kabuki Market exits and pins...')

    // Switch to World scale and verify region tiles + off-screen character pin
    const worldBtn = Array.from(host.tabRoot.querySelectorAll('.la-scale-tab')).find(
      (b) => b.textContent?.trim().startsWith('World'),
    ) as HTMLButtonElement | undefined
    expect(worldBtn).toBeDefined()
    worldBtn!.click()

    expect(host.tabRoot.textContent).toContain('Watson')
    expect(host.tabRoot.textContent).toContain('Westbrook')
    expect(host.tabRoot.textContent).toContain('8 km')
    expect(host.tabRoot.textContent).toContain('Jessie')

    // Status transitions update badge
    host.emitBackend({
      type: 'status',
      chatId: 'chat_abc',
      status: 'updating',
      message: 'Charting map…',
    })
    expect(host.getBadge()).toBe('…')

    host.emitBackend({
      type: 'status',
      chatId: 'chat_abc',
      status: 'stale',
      message: 'Chat changed.',
    })
    expect(host.getBadge()).toBe('!')

    // Chat switch clears state and requests new init
    const beforeSwitch = host.sent.length
    host.emitEvent('CHAT_SWITCHED', { chatId: 'chat_other' })
    expect(host.sent.length).toBe(beforeSwitch + 1)
    expect((host.sent[host.sent.length - 1] as { type: string }).type).toBe('init')

    // Teardown cleans up styles, tab, and all listeners
    teardown()
    expect(host.isStyleRemoved()).toBe(true)
    expect(host.isTabDestroyed()).toBe(true)
    expect(host.listenerCount()).toBe(0)

    // Late backend messages after teardown are safely ignored
    expect(() =>
      host.emitBackend({
        type: 'status',
        chatId: 'chat_other',
        status: 'ready',
        message: 'Late message',
      }),
    ).not.toThrow()
  })
})
