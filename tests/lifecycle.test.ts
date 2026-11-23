import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import type { AtlasState } from '../src/types.js'
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
  let activeChatId: string | null = 'chat_abc'

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
    getActiveChat: () => ({ chatId: activeChatId, characterId: 'char_1' }),
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
    emitBackend: (msg: unknown) => {
      for (const fn of backendListeners) fn(msg)
    },
    emitEvent: (event: string, payload: unknown) => {
      if (event === 'CHAT_SWITCHED') {
        const chatId = (payload as { chatId?: unknown } | null)?.chatId
        activeChatId = typeof chatId === 'string' ? chatId : null
      }
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
    const layerSelect = host.tabRoot.querySelector('select[aria-label="Zone map"]') as HTMLSelectElement
    expect(layerSelect.options.length).toBe(2)
    layerSelect.value = 'apartment_local'
    layerSelect.dispatchEvent(new win.Event('change') as unknown as Event)
    expect(host.tabRoot.textContent).toContain('Bedroom')
    layerSelect.value = 'kabuki_market'
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
    const scaleSelect = host.tabRoot.querySelector('select[aria-label="Map scale"]') as HTMLSelectElement
    expect(scaleSelect).not.toBeNull()
    scaleSelect.value = 'world'
    scaleSelect.dispatchEvent(new win.Event('change') as unknown as Event)

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

  test('offers three separate sections: Map, States with sidebar, and Ledger', () => {
    const host = createMockHost(win.document as unknown as Document)
    const teardown = setup(host.ctx as unknown as Parameters<typeof setup>[0])
    const browser = host.tabRoot.querySelector('.la-browser') as HTMLElement
    expect(browser).not.toBeNull()
    // Three distinct section panels
    const sections = browser.querySelectorAll('.la-section')
    expect(sections.length).toBe(3)
    // Map section has scale and zone dropdowns
    const scale = browser.querySelector('select[aria-label="Map scale"]') as HTMLSelectElement
    expect(Array.from(scale.options).map(option => option.textContent)).toEqual(['Local', 'Region', 'World'])
    expect(browser.querySelector('select[aria-label="Zone map"]')).not.toBeNull()
    // States section has sidebar navigation
    const sidebar = browser.querySelector('.la-sidebar') as HTMLElement
    expect(sidebar).not.toBeNull()
    const sidebarItems = sidebar.querySelectorAll('.la-sidebar-item')
    expect(sidebarItems.length).toBeGreaterThan(10)
    // Ledger section exists
    expect(browser.querySelector('.la-ledger-body')).not.toBeNull()
    teardown()
  })

  test('browses each group of internal state without executing markup or inventing leads', () => {
    const host = createMockHost(win.document as unknown as Document)
    const teardown = setup(host.ctx as unknown as Parameters<typeof setup>[0])
    host.emitBackend({
      type: 'init', requestId: 'uuid-v4-1', activeChatId: 'chat_abc',
      config: { enabled: true, autoUpdate: true, connectionId: 'conn_terra', reasoningMode: 'inherit' },
      connections: [], state: makeSampleState(), busy: false, statusMessage: 'Ready', error: null,
      internalState: { sections: {
        world: '<state:world><time>Midnight</time><weather>Rain</weather></state:world>',
        onscreen: '<state:onscreen><ent_on><name>Jessie</name><agenda>Waiting</agenda></ent_on></state:onscreen>',
        thoughts: '<state:thoughts><ent_think><name>Jessie</name><tQ1>A private thought</tQ1></ent_think></state:thoughts>',
        offscreen_agendas: '<state:offscreen_agendas><ent_off><name>Fox</name><agenda>Secret errand</agenda></ent_off></state:offscreen_agendas>',
        entity_state: '<state:entity_state><ent_col><name>Fox</name><look>Silver coat</look></ent_col></state:entity_state>',
        entityMem: '<state:entityMem><ent_mem><name>Fox</name><mem>Remembers rain</mem></ent_mem></state:entityMem>',
        pair: '<state:pair><pair><names>Fox and Jessie</names><mode>Wary</mode></pair></state:pair>',
        reputation: '<state:reputation><ent_rep><standing>Trusted</standing></ent_rep></state:reputation>',
        tracks: '<state:tracks><track>Private scheme</track></state:tracks>',
        leads: '<state:leads><active_leads><lead>Follow the neon sign</lead></active_leads></state:leads>',
        inv: '<state:inv><inv>One key</inv></state:inv>',
        notebook: '<state:notebook><note>&lt;img src=x onerror=alert(1)&gt;</note></state:notebook>',
      } },
    })
    const sidebar = host.tabRoot.querySelector('.la-sidebar') as HTMLElement
    const stateContent = host.tabRoot.querySelector('.la-state-content') as HTMLElement
    expect(stateContent).not.toBeNull()
    const show = (sectionId: string) => {
      const item = sidebar.querySelector(`[data-section="${sectionId}"]`) as HTMLElement
      expect(item).not.toBeNull()
      item.click()
    }
    for (const [sectionId, expected] of [
      ['world', 'Midnight'], ['onscreen', 'Jessie'],
      ['offscreen_agendas', 'Fox'], ['entityMem', 'Fox'],
      ['pair', 'Wary'], ['tracks', 'Private scheme'],
      ['inv', 'One key'],
    ]) {
      show(sectionId)
      expect(stateContent.textContent).toContain(expected)
    }
    // Expand the offscreen card to verify agenda detail
    show('offscreen_agendas')
    const cardHead = stateContent.querySelector('.la-card-head') as HTMLElement
    expect(cardHead).not.toBeNull()
    cardHead.click()
    expect(stateContent.textContent).toContain('Secret errand')
    // Expand the memory card to verify memory content
    show('entityMem')
    const memCardHead = stateContent.querySelector('.la-card-head') as HTMLElement
    expect(memCardHead).not.toBeNull()
    memCardHead.click()
    expect(stateContent.textContent).toContain('Remembers rain')
    // Notebook is a flat section — full text visible immediately without expanding, and XSS-safe
    show('notebook')
    expect(stateContent.querySelector('.la-card-head')).toBeNull()
    expect(stateContent.querySelector('img')).toBeNull()
    expect(stateContent.textContent).toContain('<img src=x onerror=alert(1)>')
    // Leads is a flat grouped section — full text visible immediately without expanding
    show('leads')
    expect(stateContent.querySelector('.la-card-head')).toBeNull()
    expect(stateContent.textContent).toContain('Follow the neon sign')
    expect(stateContent.textContent).not.toContain('Private scheme')
    host.emitBackend({ type: 'status', chatId: 'chat_abc', status: 'ready', message: 'Updated',
      internalState: { sections: { leads: '<state:leads><active_leads><lead>Ask Jessie</lead></active_leads></state:leads>' } } })
    expect(stateContent.textContent).toContain('Ask Jessie')
    expect(stateContent.textContent).not.toContain('Private scheme')
    teardown()
  })

  test('shows Ledger data only after an unambiguous explicit REVEALED activation', () => {
    const host = createMockHost(win.document as unknown as Document)
    const teardown = setup(host.ctx as unknown as Parameters<typeof setup>[0])
    host.emitBackend({ type: 'init', requestId: 'uuid-v4-1', activeChatId: 'chat_abc',
      config: { enabled: true, autoUpdate: true, connectionId: null, reasoningMode: 'off' },
      connections: [], state: null, busy: false, statusMessage: 'Ready', error: null,
      internalState: { sections: {} } })
    const ledgerBody = host.tabRoot.querySelector('.la-ledger-body') as HTMLElement
    const update = (ledger: string) => host.emitBackend({
      type: 'status', chatId: 'chat_abc', status: 'ready', message: 'Ready',
      internalState: { sections: {}, ledger },
    })
    for (const ledger of [
      '<details class="ldg-source"><activation>DORMANT</activation><stat>Secret 97</stat></details>',
      '<details class="ldg-source"><stat>Secret 97</stat></details>',
      '<details class="ldg-source"><!-- <activation>REVEALED</activation> --><stat>Secret 97</stat></details>',
      '<details class="ldg-source"><activation>REVEALED later</activation><stat>Secret 97</stat></details>',
      '<details class="ldg-source"><activation>REVEALED</activation><activation>DORMANT</activation><stat>Secret 97</stat></details>',
      '<details class="ldg-source"><activation>REVEALED</activation><stat>Secret 97',
      '<bundle><details class="ldg-source"><activation>REVEALED</activation><stat>Allowed</stat></details><details class="ldg-source"><stat>Secret 97</stat></details></bundle>',
    ]) {
      update(ledger)
      expect(ledgerBody.textContent).not.toContain('Secret 97')
      expect(ledgerBody.textContent).toContain('No revealed Ledger')
    }
    update('<details class="ldg-source"><activation>REVEALED</activation><stat>Level 3</stat><note>&lt;img src=x onerror=alert(1)&gt;</note></details>')
    expect(ledgerBody.textContent).toContain('Level 3')
    expect(ledgerBody.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(ledgerBody.querySelector('img')).toBeNull()
    teardown()
  })

  test('preserves selections on refresh and clears private data during a chat switch', () => {
    const host = createMockHost(win.document as unknown as Document)
    const teardown = setup(host.ctx as unknown as Parameters<typeof setup>[0])
    const atlas = makeSampleState()
    const archive = { ...atlas.maps.local, id: 'archive', name: 'Archived Zone' }
    const init = (requestId: string | null, chatId: string, text: string) => ({
      type: 'init' as const, requestId, activeChatId: chatId,
      config: { enabled: true, autoUpdate: true, connectionId: 'conn', reasoningMode: 'inherit' as const },
      connections: [], state: makeSampleState(chatId),
      archives: { local: [archive], region: [], world: [] }, busy: false, statusMessage: 'Ready', error: null,
      internalState: { sections: { world: `<state:world><time>${text}</time></state:world>` } },
    })
    host.emitBackend(init('uuid-v4-1', 'chat_abc', 'FIRST CHAT SECRET'))
    const zone = host.tabRoot.querySelector('select[aria-label="Zone map"]') as HTMLSelectElement
    zone.value = 'archive'
    zone.dispatchEvent(new win.Event('change') as unknown as Event)
    host.emitBackend({ type: 'status', chatId: 'chat_abc', status: 'ready', message: 'Map refreshed', state: atlas })
    expect(zone.value).toBe('archive')
    const sidebar = host.tabRoot.querySelector('.la-sidebar') as HTMLElement
    const worldItem = sidebar.querySelector('[data-section="world"]') as HTMLElement
    worldItem.click()
    const stateContent = host.tabRoot.querySelector('.la-state-content') as HTMLElement
    expect(stateContent.textContent).toContain('FIRST CHAT SECRET')
    host.emitEvent('CHAT_SWITCHED', { chatId: 'chat_other' })
    expect(stateContent.textContent).toContain('Loading')
    expect(stateContent.textContent).not.toContain('FIRST CHAT SECRET')
    const switchReq = host.sent[host.sent.length - 1] as { requestId: string; chatId: string }
    expect(switchReq.chatId).toBe('chat_other')
    host.emitBackend(init('uuid-v4-1', 'chat_abc', 'STALE SECRET'))
    host.emitBackend({ type: 'status', chatId: 'chat_abc', status: 'ready', message: 'Old',
      internalState: { sections: { world: 'STALE SECRET' } } })
    expect(stateContent.textContent).not.toContain('STALE SECRET')
    host.emitBackend(init(switchReq.requestId, 'chat_other', 'SECOND CHAT'))
    expect(stateContent.textContent).toContain('SECOND CHAT')
    expect(zone.value).toBe('kabuki_market')
    teardown()
  })

  test('states provide loading, empty and error feedback without stale data', () => {
    const host = createMockHost(win.document as unknown as Document)
    const teardown = setup(host.ctx as unknown as Parameters<typeof setup>[0])
    const sidebar = host.tabRoot.querySelector('.la-sidebar') as HTMLElement
    const worldItem = sidebar.querySelector('[data-section="world"]') as HTMLElement
    worldItem.click()
    const stateContent = host.tabRoot.querySelector('.la-state-content') as HTMLElement
    expect(stateContent.textContent).toContain('Loading states')
    host.emitBackend({ type: 'init', requestId: 'uuid-v4-1', activeChatId: 'chat_abc',
      config: { enabled: false, autoUpdate: true, connectionId: null, reasoningMode: 'off' },
      connections: [], state: null, busy: false, statusMessage: 'Ready', error: null })
    expect(stateContent.textContent).toContain('No states available')
    host.emitBackend({ type: 'status', chatId: 'chat_abc', status: 'ready', message: 'Ready',
      internalState: { sections: { world: 42 } } })
    expect(stateContent.textContent).toContain('No world data available')
    expect(stateContent.textContent).not.toContain('42')
    host.emitBackend({ type: 'status', chatId: 'chat_abc', status: 'ready', message: 'Ready',
      internalState: { sections: null } })
    expect(stateContent.textContent).toContain('Unable to load states')
    host.emitEvent('CHAT_SWITCHED', { chatId: 'chat_new' })
    expect(stateContent.textContent).toContain('Loading states')
    host.emitBackend({ type: 'status', chatId: 'chat_new', status: 'error', message: 'Failed to load' })
    expect(stateContent.textContent).toContain('Unable to load states')
    host.emitEvent('CHAT_SWITCHED', { chatId: null })
    expect(stateContent.textContent).toContain('Open a chat')
    teardown()
  })

  test('map navigation keeps archived zone selection and zoom across scale changes and refresh', () => {
    const host = createMockHost(win.document as unknown as Document)
    const teardown = setup(host.ctx as unknown as Parameters<typeof setup>[0])
    const atlas = makeSampleState()
    const archive = { ...atlas.maps.local, id: 'archive', name: 'Archive' }
    const init = {
      type: 'init', requestId: 'uuid-v4-1', activeChatId: 'chat_abc',
      config: { enabled: true, autoUpdate: true, connectionId: 'conn', reasoningMode: 'inherit' },
      connections: [], state: atlas, archives: { local: [archive], region: [], world: [] },
      busy: false, statusMessage: 'Ready', error: null,
    }
    host.emitBackend(init)
    const zone = host.tabRoot.querySelector('select[aria-label="Zone map"]') as HTMLSelectElement
    const scale = host.tabRoot.querySelector('select[aria-label="Map scale"]') as HTMLSelectElement
    const change = (select: HTMLSelectElement, value: string) => {
      select.value = value
      select.dispatchEvent(new win.Event('change') as unknown as Event)
    }
    change(zone, 'archive')
    change(scale, 'region')
    change(scale, 'local')
    expect(zone.value).toBe('archive')
    const svg = host.tabRoot.querySelector('.la-svg') as SVGElement
    const before = svg.getAttribute('viewBox')
    ;(host.tabRoot.querySelector('button[title="Zoom in"]') as HTMLButtonElement).click()
    const zoomed = svg.getAttribute('viewBox')
    expect(zoomed).not.toBe(before)
    // Zone and scale are always enabled (no view switching)
    expect(scale.disabled).toBe(false)
    expect(zone.disabled).toBe(false)
    expect(zone.value).toBe('archive')
    expect(svg.getAttribute('viewBox')).toBe(zoomed)
    const reload = Array.from(host.tabRoot.querySelectorAll('button')).find(button => button.textContent === 'Reload') as HTMLButtonElement
    reload.click()
    const requestId = (host.sent[host.sent.length - 1] as { requestId: string }).requestId
    host.emitBackend({ ...init, requestId })
    expect(zone.value).toBe('archive')
    expect(svg.getAttribute('viewBox')).toBe(zoomed)
    const tile = host.tabRoot.querySelector('[data-tile-id="arcade_walkway"]') as SVGElement
    tile.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event)
    expect((host.tabRoot.querySelector('.la-inspector') as HTMLElement).textContent).toContain('Vending alcove')
    teardown()
  })

  test('ledger-looking content cannot leak from ordinary state sections', () => {
    const host = createMockHost(win.document as unknown as Document)
    const teardown = setup(host.ctx as unknown as Parameters<typeof setup>[0])
    const secret = '<details class="ldg-source"><activation>DORMANT</activation><stat>PRIVATE LEVEL 99</stat></details>'
    host.emitBackend({ type: 'init', requestId: 'uuid-v4-1', activeChatId: 'chat_abc',
      config: { enabled: true, autoUpdate: true, connectionId: null, reasoningMode: 'off' },
      connections: [], state: null, busy: false, statusMessage: 'Ready', error: null,
      internalState: { sections: { world: `<state:world><time>Morning</time>${secret}</state:world>` } } })
    const sidebar = host.tabRoot.querySelector('.la-sidebar') as HTMLElement
    const worldItem = sidebar.querySelector('[data-section="world"]') as HTMLElement
    worldItem.click()
    const stateContent = host.tabRoot.querySelector('.la-state-content') as HTMLElement
    expect(stateContent.textContent).toContain('Morning')
    expect(stateContent.textContent).not.toContain('PRIVATE LEVEL 99')
    host.emitBackend({ type: 'status', chatId: 'chat_abc', status: 'ready', message: 'Ready',
      internalState: { sections: { world: `<state:world><ledger><stats>PRIVATE LEVEL 99</stats></ledger></state:world>` } } })
    expect(stateContent.textContent).not.toContain('PRIVATE LEVEL 99')
    host.emitBackend({ type: 'status', chatId: 'chat_abc', status: 'ready', message: 'Ready',
      internalState: { sections: { world: '<state:world><ledger>PRIVATE LEVEL 99</ledger></state:world>' } } })
    expect(stateContent.textContent).not.toContain('PRIVATE LEVEL 99')
    host.emitBackend({ type: 'status', chatId: 'chat_abc', status: 'ready', message: 'Ready',
      internalState: { sections: { world: '<state:world><ledger>PRIVATE LEVEL 99</ledger></state:world>'.replace('<ledger>', '<ledger:secret xmlns:ledger="urn:ledger">').replace('</ledger>', '</ledger:secret>') } } })
    expect(stateContent.textContent).not.toContain('PRIVATE LEVEL 99')
    host.emitBackend({ type: 'status', chatId: 'chat_abc', status: 'ready', message: 'Ready',
      internalState: { sections: { world: '<state:ledger><stat>PRIVATE LEVEL 99</stat></state:ledger>' } } })
    expect(stateContent.textContent).not.toContain('PRIVATE LEVEL 99')
    teardown()
  })

  test('does not restore a stale archived zone if it disappeared from a completed refresh', () => {
    const host = createMockHost(win.document as unknown as Document)
    const teardown = setup(host.ctx as unknown as Parameters<typeof setup>[0])
    const atlas = makeSampleState()
    const archive = { ...atlas.maps.local, id: 'archive', name: 'Archive' }
    const init = { type: 'init', requestId: 'uuid-v4-1', activeChatId: 'chat_abc',
      config: { enabled: true, autoUpdate: true, connectionId: null, reasoningMode: 'off' },
      connections: [], state: atlas, archives: { local: [archive], region: [], world: [] },
      busy: false, statusMessage: 'Ready', error: null }
    host.emitBackend(init)
    const zone = host.tabRoot.querySelector('select[aria-label="Zone map"]') as HTMLSelectElement
    zone.value = 'archive'
    zone.dispatchEvent(new win.Event('change') as unknown as Event)
    host.emitBackend({ type: 'status', chatId: 'chat_abc', status: 'ready', message: 'Ready', state: atlas,
      archives: { local: [], region: [], world: [] } })
    expect(zone.value).toBe('kabuki_market')
    host.emitBackend({ type: 'status', chatId: 'chat_abc', status: 'ready', message: 'Ready', state: atlas,
      archives: { local: [archive], region: [], world: [] } })
    expect(zone.value).toBe('kabuki_market')
    teardown()
  })

  test('a late stream from a closed chat cannot repopulate thinking', () => {
    const host = createMockHost(win.document as unknown as Document)
    const teardown = setup(host.ctx as unknown as Parameters<typeof setup>[0])
    host.emitEvent('CHAT_SWITCHED', { chatId: null })
    host.emitBackend({ type: 'stream', chatId: 'chat_abc', phase: 'thinking',
      reasoning: 'PRIVATE OLD CHAT THOUGHT', outputChars: 0, outputTail: '' })
    const thinking = host.tabRoot.querySelector('.la-thinking') as HTMLElement
    expect(thinking.hidden).toBe(true)
    expect(thinking.textContent).not.toContain('PRIVATE OLD CHAT THOUGHT')
    teardown()
  })

  test('clear an in-progress thinking preview immediately when switching chats', () => {
    const host = createMockHost(win.document as unknown as Document)
    const teardown = setup(host.ctx as unknown as Parameters<typeof setup>[0])
    host.emitBackend({ type: 'stream', chatId: 'chat_abc', phase: 'thinking',
      reasoning: 'PRIVATE OLD CHAT THOUGHT', outputChars: 0, outputTail: '' })
    const thinking = host.tabRoot.querySelector('.la-thinking') as HTMLElement
    expect(thinking.textContent).toContain('PRIVATE OLD CHAT THOUGHT')
    host.emitEvent('CHAT_SWITCHED', { chatId: 'chat_other' })
    expect(thinking.hidden).toBe(true)
    expect(thinking.textContent).not.toContain('PRIVATE OLD CHAT THOUGHT')
    teardown()
  })

  test('an update for the same chat keeps the current selection even if refresh omits optional state', () => {
    const host = createMockHost(win.document as unknown as Document)
    const teardown = setup(host.ctx as unknown as Parameters<typeof setup>[0])
    const init = { type: 'init', requestId: 'uuid-v4-1', activeChatId: 'chat_abc',
      config: { enabled: true, autoUpdate: true, connectionId: null, reasoningMode: 'off' },
      connections: [], state: null, busy: false, statusMessage: 'Ready', error: null }
    host.emitBackend(init)
    host.emitBackend({ type: 'status', chatId: 'chat_abc', status: 'ready', message: 'Ready',
      internalState: { sections: { world: '<state:world><time>sunset</time></state:world>' } } })
    const sidebar = host.tabRoot.querySelector('.la-sidebar') as HTMLElement
    const worldItem = sidebar.querySelector('[data-section="world"]') as HTMLElement
    worldItem.click()
    const stateContent = host.tabRoot.querySelector('.la-state-content') as HTMLElement
    expect(stateContent.textContent).toContain('sunset')
    const reload = Array.from(host.tabRoot.querySelectorAll('button')).find(button => button.textContent === 'Reload') as HTMLButtonElement
    reload.click()
    const requestId = (host.sent[host.sent.length - 1] as { requestId: string }).requestId
    host.emitBackend({ ...init, requestId })
    expect(stateContent.textContent).toContain('sunset')
    teardown()
  })
})
