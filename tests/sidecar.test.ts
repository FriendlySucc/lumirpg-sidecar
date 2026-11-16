import { afterAll, expect, test } from 'bun:test'

type Listener = (...args: unknown[]) => unknown
type Role = 'user' | 'assistant' | 'system'
type SyntheticMessage = { id: string; role: Role; content: string; hidden: boolean; swipe_id: number }

const previousSpindle = Object.getOwnPropertyDescriptor(globalThis, 'spindle')
const eventListeners = new Map<string, Set<Listener>>()
const permissionListeners = new Set<Listener>()
const frontendListeners = new Set<Listener>()

function subscribe(listeners: Set<Listener>, listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

Object.defineProperty(globalThis, 'spindle', {
  configurable: true,
  writable: true,
  value: {
    on(event: string, listener: Listener) {
      let listeners = eventListeners.get(event)
      if (!listeners) {
        listeners = new Set<Listener>()
        eventListeners.set(event, listeners)
      }
      return subscribe(listeners, listener)
    },
    permissions: {
      has: () => false,
      onChanged: (listener: Listener) => subscribe(permissionListeners, listener),
    },
    onFrontendMessage: (listener: Listener) => subscribe(frontendListeners, listener),
    log: { info: () => undefined },
  },
})

const testing = import('../src/backend.ts').then((backend) => backend.__testing)

afterAll(async () => {
  if (previousSpindle) Object.defineProperty(globalThis, 'spindle', previousSpindle)
  else Reflect.deleteProperty(globalThis, 'spindle')
})

function message(id: string, content: string, role: Role = 'assistant'): SyntheticMessage {
  return { id, role, content, hidden: false, swipe_id: 0 }
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function syntheticSnapshot(messages: SyntheticMessage[]) {
  const proof = await Promise.all(messages.map(async (entry) => ({
    id: entry.id,
    hash: await sha256(JSON.stringify([entry.id, entry.role, entry.content, entry.hidden, entry.swipe_id])),
  })))
  return { messages, proof, hash: await sha256(JSON.stringify(proof)) }
}

function mapRecord(id: string, name: string): string {
  return `<map><id>${id}</id><name>${name}</name></map>`
}

function locationRecord(tag: 'loc_rend' | 'loc_load', id: string, mapId: string, name: string, features: string): string {
  return `<${tag}><id>${id}</id><map_id>${mapId}</map_id><name>${name}</name><dim>1 x 1 m</dim><grid>[12, 13, 0]</grid><bbox>[-12, -7, 4, 3]</bbox><features>${features}</features><exits></exits></${tag}>`
}

const atlasNarrative = 'We wait at 📍 Bramble Gallery\nThe Ridge Region and Ivory World include Ochre Meadow, Pearl Coast and Copper Annex.'
const atlasBody = `${atlasNarrative}\n<internal_states><state:locations><map_index>${mapRecord('bramble_map', 'Bramble Gallery')}${mapRecord('ridge_region', 'Ridge Region')}${mapRecord('ivory_world', 'Ivory World')}</map_index><active_map_id>bramble_map</active_map_id>${locationRecord('loc_rend', 'gallery', 'bramble_map', 'Bramble Gallery · 80 m', 'visited: A tiled floor')}${locationRecord('loc_rend', 'meadow', 'ridge_region', 'Ochre Meadow · 12.5 km', 'known: Reed beds')}${locationRecord('loc_rend', 'coast', 'ivory_world', 'Pearl Coast · 240 m', 'known: Pale shore')}${locationRecord('loc_load', 'vault_hush', 'bramble_map', 'Violet Vault', 'known: Hidden diamonds')}${locationRecord('loc_rend', 'grotto_hush', 'ridge_region', 'Cobalt Grotto', 'unexplored: Hidden pebbles')}</state:locations></internal_states>`

const revealedBlock = '<details class="ldg-source"><activation>REVEALED</activation><awakening_evidence>The Ledger has awakened.</awakening_evidence><reveal_event>The Ledger is visible.</reveal_event><ledger_status><level>Level 4</level><stats>Clarity 7</stats></ledger_status><transactions>Gained one copper.</transactions></details>'
const revealedProposal = {
  ledger: {
    activation: 'REVEALED',
    activationEvidence: 'The Ledger has awakened.',
    level: '4',
    levelEvidence: 'Level 4',
    stats: [{ name: 'Clarity', value: '7', evidence: 'Clarity 7' }],
  },
}

function annexProposal() {
  return {
    maps: {
      local: {
        tiles: [{
          id: 'copper_annex', name: 'Copper Annex', kind: 'room', status: 'known',
          x: 10, y: 9, w: 8, h: 6, sizeLabel: '', summary: '', connections: [], hidden: false,
          evidence: 'Copper Annex',
        }],
      },
    },
  }
}

test('Atlas keeps shared bounding boxes and unit labels without exposing hidden locations', async () => {
  const api = await testing
  const input = [message('atlas_1', atlasBody)]
  const atlas = await api.extractAtlas(input, `${atlasNarrative} Violet Vault Cobalt Grotto`, 'Bramble Gallery')
  const expectedPosition = { x: -12, y: -7, w: 16, h: 10 }

  for (const scale of ['local', 'region', 'world'] as const) {
    expect(atlas.maps[scale].tiles).toHaveLength(1)
    expect(atlas.maps[scale].tiles[0]).toMatchObject(expectedPosition)
  }
  expect(atlas.maps.local.tiles[0]).toMatchObject({ name: 'Bramble Gallery', sizeLabel: '80 m', hidden: false })
  expect(atlas.maps.region.tiles[0]).toMatchObject({ name: 'Ochre Meadow', sizeLabel: '12.5 km', hidden: false })
  expect(atlas.maps.world.tiles[0]).toMatchObject({ name: 'Pearl Coast', sizeLabel: '240 m', hidden: false })
  expect(atlas.localId).toBe(atlas.maps.local.tiles[0].id)
  expect(atlas.maps.local.currentTileId).toBe(atlas.localId)

  const serialized = JSON.stringify(atlas)
  for (const secret of ['Violet Vault', 'Cobalt Grotto', 'Hidden diamonds', 'Hidden pebbles', 'unexplored:', 'vault_hush', 'grotto_hush']) {
    expect(serialized).not.toContain(secret)
  }
  const source = await api.sources(input)
  expect(source.importedMaps).toEqual(atlas.maps)
  for (const secret of ['Violet Vault', 'Cobalt Grotto', 'Hidden diamonds', 'Hidden pebbles', 'unexplored:', 'vault_hush', 'grotto_hush']) {
    expect(source.atlasText).not.toContain(secret)
    expect(JSON.stringify(source)).not.toContain(secret)
  }
})

test('messages with no maps produce empty maps at every scale', async () => {
  const api = await testing
  const inputs = [
    'A paper kite drifts across the square.',
    'A paper kite drifts across the square.\n<internal_states><state:locations><map_index></map_index></state:locations></internal_states>',
  ]
  for (const [index, content] of inputs.entries()) {
    const input = [message(`no_map_${index}`, content)]
    const atlas = await api.extractAtlas(input, content, '')
    const source = await api.sources(input)
    for (const scale of ['local', 'region', 'world'] as const) {
      expect(atlas.maps[scale].id).toBe(`${scale}_unknown`)
      expect(atlas.maps[scale].tiles).toEqual([])
      expect(atlas.maps[scale].currentTileId).toBeNull()
      expect(source.importedMaps[scale].tiles).toEqual([])
    }
    expect(atlas.localId).toBeNull()
    expect(atlas.localName).toBe('Unknown')
    expect(JSON.parse(source.atlasText)).toEqual(source.importedMaps)
  }
})

test('a standalone DORMANT Ledger suppresses fields and ignores proposed values', async () => {
  const api = await testing
  const body = 'A bell rings.\n<internal_states></internal_states><details class="ldg-source"><activation>DORMANT</activation><awakening_evidence>The Ledger has awakened.</awakening_evidence><ledger_status><level>Level 99</level><stats>DormantGem 72</stats></ledger_status><transactions>Gained a silver coin.</transactions></details>'
  const input = [message('dormant_1', body)]
  const records = api.ledgerRecords(input)
  const source = await api.sources(input)
  expect(records.revealed).toBe(false)
  expect(records.ledgerText).toContain('ACTIVATION=DORMANT')
  expect(records.evidence).toBe('')
  expect(records.transactions).toBe('')
  expect(records.facts).toBe('')
  expect(source.ledgerRevealed).toBe(false)
  for (const secret of ['Level 99', 'DormantGem', 'Gained a silver coin.']) {
    expect(JSON.stringify(records)).not.toContain(secret)
    expect(JSON.stringify(source)).not.toContain(secret)
  }

  const baseline = api.emptyEnvelope('synthetic_dormant')
  const proposal = {
    ledger: {
      activation: 'REVEALED', activationEvidence: 'The Ledger has awakened.',
      level: '99', levelEvidence: 'Level 99', experience: '72', experienceEvidence: 'DormantGem 72',
      currency: 'silver coin', currencyEvidence: 'Gained a silver coin.',
      stats: [{ name: 'DormantGem', value: '72', evidence: 'DormantGem 72' }],
      skills: [], equipment: [], quests: [], flags: [], recentChanges: ['Gained a silver coin.'],
    },
  }
  const merged = await api.mergeProposal(baseline, proposal, source, await syntheticSnapshot(input), false)
  expect(merged.state.ledger).toEqual(baseline.state.ledger)
  expect(merged.state.ledger.activation).toBe('DORMANT')
})

test('an explicit DORMANT Ledger resets a previously revealed snapshot', async () => {
  const api = await testing
  const dormant = message('dormant_reset', 'A bell rings.\n<internal_states></internal_states><details class="ldg-source"><activation>DORMANT</activation><awakening_evidence>∅</awakening_evidence><reveal_event>∅</reveal_event></details>')
  const source = await api.sources([dormant])
  const baseline = api.emptyEnvelope('synthetic_reset')
  baseline.state.ledger = { activation: 'REVEALED', level: '4', experience: '20', currency: '3', stats: [{ name: 'Clarity', value: '7' }], skills: [], equipment: [], quests: [], flags: [], recentChanges: ['old'] }
  const merged = await api.mergeProposal(baseline, {}, source, await syntheticSnapshot([dormant]), false)
  expect(merged.state.ledger).toEqual(api.emptyEnvelope('synthetic_reset').state.ledger)
})

test('only a completed standalone REVEALED Ledger after internal states is recognized', async () => {
  const api = await testing
  const valid = message('revealed_1', `A bell rings.\n<internal_states></internal_states>${revealedBlock}`)
  const records = api.ledgerRecords([valid])
  const source = await api.sources([valid])
  expect(records.revealed).toBe(true)
  expect(records.ledgerText).toContain('ACTIVATION=REVEALED')
  expect(records.ledgerText).toContain('Level 4')
  expect(records.evidence).toContain('The Ledger has awakened.')
  expect(records.transactions).toBe('Gained one copper.')
  expect(records.facts).toContain('Clarity 7')
  expect(source.ledgerRevealed).toBe(true)

  const invalid = [
    'A bell rings.\n<internal_states><activation>REVEALED</activation></internal_states>',
    `A bell rings.\n<internal_states>${revealedBlock}</internal_states>`,
    `A bell rings.\n${revealedBlock}<internal_states></internal_states>`,
    'A bell rings.\n<internal_states></internal_states><details class="ldg-source"><activation>REVEALED</activation>',
  ]
  for (const [index, content] of invalid.entries()) {
    const input = [message(`invalid_ledger_${index}`, content)]
    expect(api.ledgerRecords(input).revealed).toBe(false)
    expect((await api.sources(input)).ledgerRevealed).toBe(false)
  }
  expect(api.ledgerRecords([valid, message('later_1', 'The bell stops.')]).revealed).toBe(false)
})

test('readPosition rejects coordinates that cannot form in-bounds geometry', async () => {
  const { readPosition } = await testing
  expect(readPosition('[-50, -50, 0]')).toEqual({ x: -50, y: -50, w: 20, h: 15 })
  expect(readPosition('[49, 49, 0]')).toEqual({ x: 49, y: 49, w: 1, h: 1 })
  for (const value of ['[-51, 0, 0]', '[0, -51, 0]', '[51, 0, 0]', '[0, 51, 0]', '[50, 0, 0]', '[0, 50, 0]', '[NaN, 0, 0]', '[1, 2]']) {
    expect(readPosition(value)).toBeNull()
  }
})

test('an analyzed fresh envelope roundtrips with matching synthetic proof', async () => {
  const api = await testing
  const chatId = 'synthetic_roundtrip'
  const input = [message('roundtrip_user', 'We follow the paper kite.', 'user'), message('roundtrip_assistant', `${atlasBody}${revealedBlock}`)]
  const snapshot = await syntheticSnapshot(input)
  const source = await api.sources(input)
  const baseline = api.emptyEnvelope(chatId)
  const analyzed = await api.mergeProposal(baseline, revealedProposal, source, snapshot, false)
  const saved = api.readSavedEnvelope(JSON.parse(JSON.stringify(analyzed)), chatId)

  expect(baseline.state.analyzedHash).toBeNull()
  expect(saved).toEqual(analyzed)
  expect(saved.state.analyzedMessageId).toBe('roundtrip_assistant')
  expect(saved.state.analyzedHash).toBe(snapshot.hash)
  expect(saved.proof).toEqual(snapshot.proof)
  expect(saved.state.maps.local.tiles).toHaveLength(1)
  expect(saved.state.ledger.activation).toBe('REVEALED')
  expect(saved.state.ledger.level).toBe('4')
  expect(saved.state.ledger.stats).toEqual([{ name: 'Clarity', value: '7' }])
  expect(api.compatible(saved.proof, snapshot.proof)).toBe(true)
  const changedProof = snapshot.proof.map((entry, index) => index === snapshot.proof.length - 1 ? { ...entry, hash: '0'.repeat(64) } : entry)
  expect(api.compatible(saved.proof, changedProof)).toBe(false)
  expect(() => api.readSavedEnvelope({ ...saved, proof: [] }, chatId)).toThrow()
  const wrongLastId = saved.proof.map((entry, index) => index === saved.proof.length - 1 ? { ...entry, id: 'wrong_message' } : entry)
  expect(() => api.readSavedEnvelope({ ...saved, proof: wrongLastId }, chatId)).toThrow()
})

test('a map proposal without an id updates an existing baseline without losing its Atlas tile', async () => {
  const api = await testing
  const atlasSource = await api.sources([message('baseline_atlas', atlasBody)])
  const existingMap = atlasSource.importedMaps.local
  expect(existingMap.tiles).toHaveLength(1)
  const baseline = api.emptyEnvelope('synthetic_existing_map')
  baseline.state.maps.local = JSON.parse(JSON.stringify(existingMap))
  const input = [message('map_update', 'Copper Annex is north of Bramble Gallery.')]
  const source = await api.sources(input)
  const merged = await api.mergeProposal(baseline, annexProposal(), source, await syntheticSnapshot(input), false)

  expect(merged.state.maps.local.id).toBe(existingMap.id)
  expect(merged.state.maps.local.tiles).toHaveLength(2)
  expect(merged.state.maps.local.tiles.find((tile) => tile.id === existingMap.tiles[0].id)).toEqual(existingMap.tiles[0])
  expect(merged.state.maps.local.tiles.find((tile) => tile.name === 'Copper Annex')).toMatchObject({ x: 10, y: 9, w: 8, h: 6 })
})

test('a map proposal without an id also updates a just-imported Atlas baseline', async () => {
  const api = await testing
  const input = [message('new_atlas', atlasBody)]
  const source = await api.sources(input)
  const existingMap = source.importedMaps.local
  expect(existingMap.tiles).toHaveLength(1)
  const merged = await api.mergeProposal(api.emptyEnvelope('synthetic_imported_map'), annexProposal(), source, await syntheticSnapshot(input), false)

  expect(merged.state.maps.local.id).toBe(existingMap.id)
  expect(merged.state.maps.local.tiles).toHaveLength(2)
  expect(merged.state.maps.local.tiles.find((tile) => tile.id === existingMap.tiles[0].id)).toEqual(existingMap.tiles[0])
  expect(merged.state.maps.local.tiles.find((tile) => tile.name === 'Copper Annex')).toMatchObject({ x: 10, y: 9, w: 8, h: 6 })
})
