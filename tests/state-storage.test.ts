import { expect, test } from 'bun:test'
import { applyStateDelta, migrateLastInternalState, renderStateForPrompt } from '../src/internal-state.js'
import { decodeStoredState, encodeStoredState, type StoredStateV2 } from '../src/state-storage.js'

test('ordinary fields and repeated records persist as ordered JSON, with no XML snapshot', () => {
  const state = { sections: { entityMem: '<state:entityMem><ent_mem><name> Nia &amp; Co </name><mem>first</mem><mem>second</mem></ent_mem><ent_mem><name>Nia</name></ent_mem></state:entityMem>' } }
  const stored: StoredStateV2 = encodeStoredState(state)
  expect(stored).toEqual({ sections: { entityMem: ['state:entityMem', [
    ['ent_mem', [['name', ' Nia & Co '], ['mem', 'first'], ['mem', 'second']]],
    ['ent_mem', [['name', 'Nia']]],
  ]] } })
  const restored = decodeStoredState(JSON.parse(JSON.stringify(stored)))
  expect(restored).toEqual(state)
  expect(renderStateForPrompt(restored)).toBe(renderStateForPrompt(state))
})

test('legacy mixed content keeps lexical exceptions without storing its subtree as raw XML', () => {
  const xml = '<state:world  rev = \'a>b\' >\r\n' +
    '<loc xml:lang="el">Atrium &amp; hall<!-- <old/> --> / <![CDATA[<north> & east]]> ' +
    '&#x000041;&#66;&quot;&apos; &gt; > <x:mark flag="&#x9;" />end</loc  >' +
    '\n<odd-tag></odd-tag><empty/>\t</state:world\n>'
  const state = { sections: { world: xml } }
  const stored = encodeStoredState(state)
  const json = JSON.stringify(stored)
  expect(json).not.toContain('<loc')
  expect(json).not.toContain('<x:mark')
  expect(json).toContain('Atrium & hall')
  expect(json).not.toContain('Atrium &amp; hall')
  expect(decodeStoredState(JSON.parse(json))).toEqual(state)
})

test('an updated legacy envelope keeps only its layout; current sections and Ledger render exactly', () => {
  const ledger = '<details class="ldg-source"><!-- </details> --><stat> DORMANT </stat></details>'
  const envelope = '<internal_states xmlns:state="urn:vexa" v=\'3\'>\r\n' +
    '<state:vent><vent>private</vent></state:vent>\n<!-- <state:world/> stays a comment -->\n' +
    '<state:world rev="1"><time>old snapshot</time></state:world></internal_states >'
  const original = migrateLastInternalState([{ role: 'assistant', content: envelope + '\n' + ledger }])
  expect(decodeStoredState(JSON.parse(JSON.stringify(encodeStoredState(original))))).toEqual(original)
  const current = applyStateDelta(original, {
    world: { fields: { time: 'first light' } }, inv: { fields: { inv: 'compass' } },
  })
  const stored = encodeStoredState(current)
  expect(stored.ledger).toBe(ledger)
  const json = JSON.stringify(stored)
  expect(json).not.toContain('old snapshot')
  expect(json.match(/first light/g)).toHaveLength(1)
  expect(json.match(/private/g)).toHaveLength(1)
  const restored = decodeStoredState(JSON.parse(json))
  expect(restored.sections).toEqual(current.sections)
  expect(restored.ledger).toBe(ledger)
  expect(restored.envelope).toBe(envelope.replace('old snapshot', 'first light'))
  expect(renderStateForPrompt(restored)).toBe(renderStateForPrompt(current))
  // New sections still follow v0.4 order, not order of addition after reload.
  const later = { leads: '<state:leads><lead>follow up</lead></state:leads>' }
  expect(renderStateForPrompt(applyStateDelta(restored, later))).toBe(renderStateForPrompt(applyStateDelta(current, later)))
  expect(encodeStoredState(restored)).toEqual(stored)
  expect(current.envelope).toBe(envelope)
})

test('only plain JSON data is read; accessors, prototypes, holes and cycles fail closed', () => {
  const root = ['state:world', '']
  let reads = 0
  const getter = { enumerable: true, get() { reads++; return '' } }
  const customArray = Object.setPrototypeOf([...root], Object.create(Array.prototype))
  const cycle: unknown[] = ['state:world', []]
  ;(cycle[1] as unknown[]).push(cycle)
  for (const payload of [
    {}, { sections: [] }, { sections: new Date() }, { sections: {}, extra: 'lost?' },
    Object.create({ sections: {} }), Object.defineProperty({}, 'sections', getter),
    { sections: Object.create({ world: root }) }, { sections: Object.defineProperty({}, 'world', getter) },
    { sections: JSON.parse('{"__proto__":{}}') }, { sections: { constructor: root } },
    { sections: { [Symbol('ignored')]: root } },
    { sections: {}, ledger: undefined }, { sections: {}, envelope: undefined },
    ...[
      Object.assign([...root], { extra: true }), Object.defineProperty([...root], 1, getter),
      Object.defineProperty([...root], 1, { value: '', enumerable: false }),
      customArray, ['state:world', Array(1)], cycle,
    ].map(world => ({ sections: { world } })),
  ]) expect(() => decodeStoredState(payload)).toThrow()
  expect(reads).toBe(0)
  // Null-prototype data records are plain too; read-only inputs needn't be cloned by the caller.
  const frozen = Object.freeze({ sections: Object.freeze(Object.assign(Object.create(null), { world: Object.freeze(root) })) })
  expect(decodeStoredState(frozen).sections.world).toBe('<state:world></state:world>')
})
