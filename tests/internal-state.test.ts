import { expect, test } from 'bun:test'
import { migrateLastInternalState, applyStateDelta, renderStateForPrompt } from '../src/internal-state.js'

test('migration selects the latest complete state envelope and preserves original XML', () => {
  const earlier = '<internal_states><state:world><time>morning</time></state:world></internal_states>'
  const later = '<internal_states><state:world><time>night</time></state:world><state:entityMem><ent_mem><name>A</name><mem>Knows B</mem></ent_mem></state:entityMem></internal_states>'
  const state = migrateLastInternalState([{ role:'assistant', content:earlier }, { role:'user', content:'hello' }, { role:'assistant', content:`Story ${later} text` }])
  expect(state.sections.world).toContain('<time>night</time>')
  expect(state.sections.entityMem).toContain('<mem>Knows B</mem>')
  expect(renderStateForPrompt(state)).toContain(state.sections.entityMem)
})

test('legacy envelope and Ledger sentinels inside comments are not actual state', () => {
  const message = '<!-- <internal_states><state:world><time>old</time></state:world></internal_states> --><!-- <details class="ldg-source"><stat>fake</stat></details> -->'
  expect(migrateLastInternalState([{ role: 'assistant', content: message }])).toEqual({ sections: {} })
})

test('migration rejects a newer incomplete envelope instead of silently using stale state', () => {
  const messages = [
    { role: 'assistant', content: '<internal_states><state:world><time>old</time></state:world></internal_states>' },
    { role: 'assistant', content: '<internal_states><state:world><time>new</time></state:world>' },
  ]
  expect(() => migrateLastInternalState(messages)).toThrow()
})

test('migration rejects malformed nested tags and unknown state sections rather than dropping data', () => {
  for (const xml of [
    '<internal_states><state:world><time>now</state:world></internal_states>',
    '<internal_states><state:world/><state:unknown><x>data</x></state:unknown></internal_states>',
  ]) expect(() => migrateLastInternalState([{ role: 'assistant', content: xml }])).toThrow()
})

test('malformed nested envelope markers are not silently discarded', () => {
  for (const xml of [
    '<internal_states><state:world/><internal_states><state:inv/></internal_states></internal_states>',
    '<internal_states><state:world/><internal_states><state:inv/></internal_states>',
    '</internal_states><internal_states><state:world/></internal_states>',
  ]) expect(() => migrateLastInternalState([{ role: 'assistant', content: xml }])).toThrow()
})

test('malformed legacy prefixes and XML characters fail closed', () => {
  for (const xml of [
    '<internal_states><state:world><loc>A & B</loc></state:world></internal_states>',
    '<internal_states><state:world><loc>&#0;</loc></state:world></internal_states>',
    '<internal_states><state:world/><state:unknown/></internal_states>',
    '<internal_states><state:world a="<"/></internal_states>',
    '<internal_states><state:world><loc>text\u0001</loc></state:world></internal_states>',
    '<internal_states><state:world/>',
  ]) expect(() => migrateLastInternalState([{ role: 'assistant', content: xml }])).toThrow()
})

test('an incomplete state section outside an envelope cannot masquerade as no legacy data', () => {
  expect(() => migrateLastInternalState([{ role: 'assistant', content: 'Story <state:world><time>broken' }])).toThrow()
})

test('partial extra state sections beside a valid envelope are not silently discarded', () => {
  const valid = '<internal_states><state:world/></internal_states>'
  expect(() => migrateLastInternalState([{ role: 'assistant', content: `${valid}<state:inv>partial` }])).toThrow()
})

test('migration can conservatively import explicitly selected earlier records or sections', () => {
  const prior = '<internal_states><state:offscreen_agendas><ent_off><name>A</name><agenda>old</agenda></ent_off><ent_off><name>B</name><agenda>prior B</agenda></ent_off><ent_off><name>C</name><agenda>removed</agenda></ent_off></state:offscreen_agendas><state:locations><place>Archive</place></state:locations></internal_states>'
  const latest = '<internal_states><state:offscreen_agendas><ent_off><name>A</name><agenda>new</agenda></ent_off></state:offscreen_agendas><state:entityMem/></internal_states>'
  const messages = [{ role: 'assistant', content: prior }, { role: 'assistant', content: latest }]
  const baseline = migrateLastInternalState(messages)
  expect(baseline.sections.offscreen_agendas).not.toContain('prior B')
  expect(baseline.sections.locations).toBeUndefined()
  const imported = migrateLastInternalState(messages, { sections: ['locations'], records: { offscreen_agendas: ['B'] } })
  expect(imported.sections.offscreen_agendas).toContain('<name>A</name><agenda>new</agenda>')
  expect(imported.sections.offscreen_agendas).toContain('<name>B</name><agenda>prior B</agenda>')
  expect(imported.sections.offscreen_agendas).not.toContain('removed')
  expect(imported.sections.locations).toContain('<place>Archive</place>')
  expect(imported.sections.entityMem).toBe('<state:entityMem/>')
})

test('legacy imports refuse ambiguous, unknown or already-present selections', () => {
  const old = '<internal_states><state:offscreen_agendas><ent_off><name>B</name></ent_off><ent_off><name>B</name></ent_off></state:offscreen_agendas></internal_states>'
  const recent = '<internal_states><state:offscreen_agendas><ent_off><name>A</name></ent_off></state:offscreen_agendas></internal_states>'
  const messages = [{ role: 'assistant', content: old }, { role: 'assistant', content: recent }]
  expect(() => migrateLastInternalState(messages, { records: { offscreen_agendas: ['B'] } })).toThrow()
  expect(() => migrateLastInternalState(messages, { records: { offscreen_agendas: ['A'] } })).toThrow()
  expect(() => migrateLastInternalState(messages, { records: { offscreen_agendas: ['C'] } })).toThrow()
  expect(() => migrateLastInternalState(messages, { sections: ['offscreen_agendas'] })).toThrow()
  expect(() => migrateLastInternalState(messages, { sections: ['unknown'] })).toThrow()
})

test('explicit legacy selection searches multiple envelopes in one message without restoring anything else', () => {
  const previous = '<internal_states><state:locations><place>Earlier</place></state:locations></internal_states>'
  const latest = '<internal_states><state:world><time>new</time></state:world></internal_states>'
  const imported = migrateLastInternalState([{ role: 'assistant', content: previous + latest }], { sections: ['locations'] })
  expect(imported.sections.locations).toBe('<state:locations><place>Earlier</place></state:locations>')
})

test('prompt rendering retains the envelope metadata, comments and section order', () => {
  const xml = '<internal_states xmlns:state="urn:vexa" version="3">\n<!-- legacy context -->\n<state:vent><vent>private</vent></state:vent>\n<state:world><time>now</time></state:world>\n</internal_states>'
  const state = migrateLastInternalState([{ role: 'assistant', content: xml }])
  const next = applyStateDelta(state, { world: { fields: { time: 'later' } } })
  expect(renderStateForPrompt(next)).toBe(xml.replace('<time>now</time>', '<time>later</time>'))
})

test('legacy Ledger remains separate and is never invented or erased by state deltas', () => {
  const ledger = '<details class="ldg-source"><activation>DORMANT</activation><stat>legacy</stat></details>'
  const source = `<internal_states><state:world><time>now</time></state:world></internal_states>\n${ledger}`
  const seeded = migrateLastInternalState([{ role: 'assistant', content: source }])
  expect(seeded.ledger).toBe(ledger)
  const updated = applyStateDelta(seeded, { world: { fields: { time: 'later' } } })
  expect(updated.ledger).toBe(ledger)
  expect(renderStateForPrompt(updated)).toContain(ledger)
  const absent = migrateLastInternalState([{ role: 'assistant', content: '<internal_states><state:world/></internal_states>' }])
  expect(absent.ledger).toBeUndefined()
  expect(renderStateForPrompt(absent)).not.toContain('ldg-source')
})

test('Ledger alone is preserved and later state does not reactivate stale Ledger', () => {
  const ledger = '<details class="ldg-source"><activation>DORMANT</activation><stat>old</stat></details>'
  const alone = migrateLastInternalState([{ role: 'assistant', content: ledger }])
  expect(alone.ledger).toBe(ledger)
  expect(renderStateForPrompt(alone)).toBe(ledger)
  const later = migrateLastInternalState([{ role: 'assistant', content: ledger }, { role: 'assistant', content: '<internal_states><state:world/></internal_states>' }])
  expect(later.ledger).toBeUndefined()
})

test('Ledger ownership ignores fake class names and flags malformed exact-class blocks', () => {
  const fake = '<details class="not-ldg-source"><stat>unrelated</stat></details>'
  expect(migrateLastInternalState([{ role: 'assistant', content: fake }]).ledger).toBeUndefined()
  const incomplete = '<details class="ldg-source"><stat>unfinished</stat>'
  expect(() => migrateLastInternalState([{ role: 'assistant', content: incomplete }])).toThrow()
})

test('Ledger closing markers inside comments cannot truncate the real Ledger', () => {
  const ledger = '<details class="ldg-source"><!-- </details> --><activation>DORMANT</activation></details>'
  expect(migrateLastInternalState([{ role: 'assistant', content: ledger }]).ledger).toBe(ledger)
})

test('multiple legacy Ledger candidates are rejected rather than silently discarded', () => {
  const first = '<details class="ldg-source"><activation>DORMANT</activation></details>'
  const second = '<details class="ldg-source"><activation>REVEALED</activation></details>'
  expect(() => migrateLastInternalState([{ role: 'assistant', content: first + second }])).toThrow()
})

test('full legacy fixture keeps all 18 sections, 23 agendas and directional relationships', () => {
  const offscreen = Array.from({ length: 23 }, (_, i) => `<ent_off><name>NPC ${i}</name><loc>place ${i}</loc><agenda>agenda ${i}</agenda></ent_off>`).join('')
  const profiles = Array.from({ length: 7 }, (_, i) => `<ent_col><name>NPC ${i}</name><look>look ${i}</look></ent_col>`).join('')
  const bodies: Record<string, string> = {
    world: '<loc>Market</loc>', onscreen: '<ent_on><name>Hero</name><agenda>wait</agenda></ent_on>',
    offscreen_agendas: offscreen, locations: '<place>Market</place>',
    entityMem: '<ent_mem><name>Hero</name><mem>Remembers rain</mem><mem>Knows NPC 1</mem></ent_mem>',
    entity_state: profiles, thoughts: '<ent_think><name>Hero</name><tQ1>quiet</tQ1></ent_think>',
    dam: '<ent_dam><pair>Hero→NPC 1</pair><intent>trust</intent></ent_dam><ent_dam><pair>NPC 1→Hero</pair><intent>doubt</intent></ent_dam>',
    pair: '<pair><names>Hero↔NPC 1</names><matrix>😀😃😄😁😆😅😂🤣😊😇🙂🙃</matrix></pair>',
    reputation: '<ent_rep><name>Hero</name><standing>Trusted</standing></ent_rep>', tracks: '<track>pursuit</track>',
    arc: '<stage>first</stage>', chekhov: '<item>key</item>', leads: '<lead>clue</lead>', inv: '<inv>coin</inv>',
    story_notes: '<threads>mystery</threads>', notebook: '<note>private</note>', vent: '<vent>thought</vent>',
  }
  const xml = `<internal_states>${Object.entries(bodies).map(([name, body]) => `<state:${name}>${body}</state:${name}>`).join('')}</internal_states>`
  const messages = [{ role: 'assistant', content: xml }]
  const current = migrateLastInternalState(messages)
  const next = applyStateDelta(current, { offscreen_agendas: { records: [{ name: 'NPC 12', fields: { loc: 'new place' } }] }, entityMem: { append: [{ name: 'Hero', entries: ['Remembers rain', 'New fact'] }] } })
  expect(Object.keys(next.sections)).toHaveLength(18)
  expect((next.sections.offscreen_agendas.match(/<ent_off>/g) ?? [])).toHaveLength(23)
  expect((next.sections.entity_state.match(/<ent_col>/g) ?? [])).toHaveLength(7)
  expect(next.sections.dam).toBe(current.sections.dam)
  expect(next.sections.pair).toBe(current.sections.pair)
  expect(next.sections.reputation).toBe(current.sections.reputation)
  expect(renderStateForPrompt(next)).toContain('<mem>New fact</mem>')
  expect(messages[0].content).toBe(xml)
})

test('new beta reputation survives migration and prompt rendering', () => {
  const xml = '<internal_states><state:reputation><ent_rep><name>Fox</name><standing>Trusted</standing></ent_rep></state:reputation></internal_states>'
  const state = migrateLastInternalState([{role:'assistant',content:xml}])
  expect(state.sections.reputation).toContain('Trusted')
  expect(renderStateForPrompt(state)).toContain('Trusted')
})

test('section-scoped changes preserve all omitted sections', () => {
  const current = migrateLastInternalState([{role:'assistant',content:'<internal_states><state:world><time>morning</time><weather>rain</weather></state:world><state:inv><inv>tools</inv></state:inv></internal_states>'}])
  const updated = applyStateDelta(current, { world: { fields: { time: 'noon' } } })
  expect(updated.sections.world).toContain('<time>noon</time>')
  expect(updated.sections.inv).toEqual(current.sections.inv)
  expect(current.sections.world).toContain('<time>morning</time>')
})

test('full-section replacement cannot silently drop existing records or fields', () => {
  const current = { sections: { offscreen_agendas: '<state:offscreen_agendas><ent_off><name>A</name><agenda>Keep</agenda></ent_off><ent_off><name>B</name><agenda>Keep B</agenda></ent_off></state:offscreen_agendas>' } }
  expect(() => applyStateDelta(current, { offscreen_agendas: '<state:offscreen_agendas><ent_off><name>A</name><agenda>Changed</agenda></ent_off></state:offscreen_agendas>' })).toThrow()
  const first = applyStateDelta({ sections: {} }, { offscreen_agendas: '<state:offscreen_agendas><ent_off><name>A</name></ent_off></state:offscreen_agendas>' })
  expect(first.sections.offscreen_agendas).toContain('<name>A</name>')
  // Blank/empty sections bootstrapped on a fresh chat can be initialized with a full XML string
  const blank = { sections: { leads: '<state:leads></state:leads>', onscreen: '<state:onscreen>∅</state:onscreen>' } }
  const initialized = applyStateDelta(blank, {
    leads: '<state:leads><active_leads><lead>Check the border quarry</lead></active_leads></state:leads>',
    onscreen: '<state:onscreen><ent_on><name>Elena</name></ent_on></state:onscreen>',
  })
  expect(initialized.sections.leads).toContain('Check the border quarry')
  expect(initialized.sections.onscreen).toContain('Elena')
})

test('record patches update one named character without deleting another or other fields', () => {
  const xml = '<internal_states><state:offscreen_agendas><ent_off><name>A</name><loc>Market</loc><agenda>Sell</agenda></ent_off><ent_off><name>B</name><loc>Home</loc><agenda>Rest</agenda></ent_off></state:offscreen_agendas></internal_states>'
  const current = migrateLastInternalState([{role:'assistant',content:xml}])
  const updated = applyStateDelta(current, { offscreen_agendas: { records: [ { name:'A', fields:{loc:'Street'} } ] } })
  expect(updated.sections.offscreen_agendas).toContain('<loc>Street</loc>')
  expect(updated.sections.offscreen_agendas).toContain('<agenda>Sell</agenda>')
  expect(updated.sections.offscreen_agendas).toContain('<name>B</name><loc>Home</loc><agenda>Rest</agenda>')
})

test('directional DAM record changes do not affect the reverse relationship', () => {
  const current = { sections: { dam: '<state:dam><ent_dam><pair>A→B</pair><intent>trust</intent></ent_dam><ent_dam><pair>B→A</pair><intent>doubt</intent></ent_dam></state:dam>' } }
  const next = applyStateDelta(current, { dam: { records: [{ name: 'A→B', fields: { intent: 'help' } }] } })
  expect(next.sections.dam).toContain('<pair>A→B</pair><intent>help</intent>')
  expect(next.sections.dam).toContain('<pair>B→A</pair><intent>doubt</intent>')
})

test('full-section replacements are explicit and generic replacement of identity paths is rejected', () => {
  const current = { sections: { dam: '<state:dam><ent_dam><pair>A→B</pair><intent>trust</intent></ent_dam></state:dam>' } }
  expect(() => applyStateDelta(current, { dam: { ops: [{ op: 'set', path: ['ent_dam', 'pair'], value: 'B→A' }] } })).toThrow()
})

test('record identity uses exact decoded text and does not confuse whitespace variants', () => {
  const original = '<state:offscreen_agendas><ent_off><name>A</name><loc>one</loc></ent_off><ent_off><name> A </name><loc>two</loc></ent_off><ent_off><name>A &amp; B</name><loc>three</loc></ent_off></state:offscreen_agendas>'
  const current = { sections: { offscreen_agendas: original } }
  const updated = applyStateDelta(current, { offscreen_agendas: { records: [
    { name: ' A ', fields: { loc: 'new two' } },
    { name: 'A & B', fields: { loc: 'new three' } },
  ] } })
  expect(updated.sections.offscreen_agendas).toContain('<name>A</name><loc>one</loc>')
  expect(updated.sections.offscreen_agendas).toContain('<name> A </name><loc>new two</loc>')
  expect(updated.sections.offscreen_agendas).toContain('<name>A &amp; B</name><loc>new three</loc>')
})

test('memory deltas append only new facts to the named entity and keep other entities intact', () => {
  const xml = '<internal_states><state:entityMem><ent_mem><name>A</name><mem>Knows B</mem></ent_mem><ent_mem><name>B</name><mem>Likes tea</mem></ent_mem></state:entityMem></internal_states>'
  const current = migrateLastInternalState([{role:'assistant', content:xml}])
  const updated = applyStateDelta(current, { entityMem: { append: [{ name:'A', entries: ['Knows B','Learned C'] }] } })
  expect(updated.sections.entityMem).toContain('<mem>Knows B</mem><mem>Learned C</mem>')
  expect(updated.sections.entityMem).toContain('<name>B</name><mem>Likes tea</mem>')
  expect(current.sections.entityMem).not.toContain('Learned C')
})

test('memory append preserves exact facts, detects semantic duplicates and rejects ambiguity', () => {
  const current = { sections: { entityMem: '<state:entityMem><ent_mem><name>A</name><mem> A &amp; B </mem><mem>A &amp; B</mem></ent_mem></state:entityMem>' } }
  const next = applyStateDelta(current, { entityMem: { append: [{ name: 'A', entries: [' A & B ', ' New '] }] } })
  expect(next.sections.entityMem).toContain('<mem> A &amp; B </mem><mem>A &amp; B</mem><mem> New </mem>')
  const ambiguous = { sections: { entityMem: '<state:entityMem><ent_mem><name>A</name></ent_mem><ent_mem><name>A</name></ent_mem></state:entityMem>' } }
  expect(() => applyStateDelta(ambiguous, { entityMem: { append: [{ name: 'A', entries: ['x'] }] } })).toThrow()
  expect(() => applyStateDelta(current, { entityMem: { append: [{ name: 'A', entries: ['x'], extra: 'ignored' }] } })).toThrow()
})

test('field patches change only named scalar fields and preserve the rest', () => {
  const current = migrateLastInternalState([{role:'assistant', content:'<internal_states><state:world><time>morning</time><weather>rain</weather><loc>Market</loc></state:world></internal_states>'}])
  const updated = applyStateDelta(current, { world: { fields: { time: 'noon' } } })
  expect(updated.sections.world).toContain('<time>noon</time>')
  expect(updated.sections.world).toContain('<weather>rain</weather>')
  expect(updated.sections.world).toContain('<loc>Market</loc>')
})

test('scalar fields update direct elements only and reject duplicate targets', () => {
  const current = { sections: { world: '<state:world><extra><time>nested</time></extra><time>old</time><weather>rain</weather></state:world>' } }
  const next = applyStateDelta(current, { world: { fields: { time: 'new' } } })
  expect(next.sections.world).toBe('<state:world><extra><time>nested</time></extra><time>new</time><weather>rain</weather></state:world>')
  const duplicate = { sections: { world: '<state:world><time>a</time><time>b</time></state:world>' } }
  expect(() => applyStateDelta(duplicate, { world: { fields: { time: 'c' } } })).toThrow()
  const empty = { sections: { world: '<state:world/>' } }
  expect(applyStateDelta(empty, { world: { fields: { time: 'now' } } }).sections.world).toBe('<state:world><time>now</time></state:world>')
})

test('precise generic operations update nested paths and append without replacing array siblings', () => {
  const matrix = ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃'].map((face, i) => `<cell><name>${i}</name><value>${face}</value></cell>`).join('')
  const state = { sections: { pair: `<state:pair><pair><names>A↔B</names><matrix>${matrix}</matrix></pair><pair><names>A↔C</names><matrix>unchanged</matrix></pair></state:pair>`, reputation: '<state:reputation><ent_rep><name>Fox</name><standing>Known</standing></ent_rep></state:reputation>' } }
  const updated = applyStateDelta(state, {
    pair: { operations: [{ op: 'set', path: [{ tag: 'pair', where: { tag: 'names', value: 'A↔B' } }, 'matrix', { tag: 'cell', where: { tag: 'name', value: '4' } }, 'value'], value: '⭐' }] },
    reputation: { operations: [{ op: 'append', path: [{ tag: 'ent_rep', where: { tag: 'name', value: 'Fox' } }], xml: '<note>Witnessed &amp; remembered</note>' }] },
  })
  expect(updated.sections.pair).toContain('<name>4</name><value>⭐</value>')
  expect(updated.sections.pair).toContain('<name>11</name><value>🙃</value>')
  expect(updated.sections.pair).toContain('<names>A↔C</names><matrix>unchanged</matrix>')
  expect(updated.sections.reputation).toContain('<note>Witnessed &amp; remembered</note>')
  expect(state.sections.pair).toContain('<name>4</name><value>😆</value>')
})

test('generic ops match the background analyzer contract', () => {
  const current = { sections: { tracks: '<state:tracks><track><name>A</name><value>old</value></track></state:tracks>' } }
  const next = applyStateDelta(current, { tracks: { ops: [{ op: 'set', path: ['track', 'value'], value: 'new' }] } })
  expect(next.sections.tracks).toContain('<value>new</value>')
  // Missing known containers in leads/chekhov and known stages in arc are created safely
  const partial = {
    sections: {
      leads: '<state:leads><active_leads><lead>Keep me</lead></active_leads></state:leads>',
      chekhov: '<state:chekhov><chamber><bullet>Loaded gun</bullet></chamber></state:chekhov>',
      arc: '<state:arc><info>Act 1</info><ki>Betrayal</ki></state:arc>',
    },
  }
  const extended = applyStateDelta(partial, {
    leads: { ops: [{ op: 'append', path: ['usable'], xml: '<lead>Guild debt</lead>' }] },
    chekhov: { ops: [{ op: 'append', path: ['locked'], xml: '<bullet>Broken seal</bullet>' }] },
    arc: { ops: [{ op: 'set', path: ['sho'], value: 'Escape from the ruins' }] },
  })
  expect(extended.sections.leads).toContain('<lead>Keep me</lead>')
  expect(extended.sections.leads).toContain('<usable><lead>Guild debt</lead></usable>')
  expect(extended.sections.chekhov).toContain('<locked><bullet>Broken seal</bullet></locked>')
  expect(extended.sections.arc).toContain('<sho>Escape from the ruins</sho>')

  // Direct-text selectors (#text, text(), ., { text }) and redundant leading state:<section> step work safely
  const textTracks = {
    sections: {
      tracks: '<state:tracks><main>Survive</main><track>Guild Debt | open | 10g</track><track>Exile | open | fresh</track></state:tracks>',
    },
  }
  const t1 = applyStateDelta(textTracks, {
    tracks: {
      ops: [
        { op: 'set', path: [{ tag: 'track', where: { tag: '#text', value: 'Guild Debt | open | 10g' } }], value: 'Guild Debt | paid | 0g' },
        { op: 'set', path: ['state:tracks', { tag: 'track', where: { text: 'Exile | open | fresh' } }], value: 'Exile | active | moving on' },
      ],
    },
  })
  expect(t1.sections.tracks).toContain('<track>Guild Debt | paid | 0g</track>')
  expect(t1.sections.tracks).toContain('<track>Exile | active | moving on</track>')
  expect(() => applyStateDelta(textTracks, { tracks: { ops: [{ op: 'set', path: ['state:world', 'main'], value: 'nope' }] } })).toThrow(/state:world/)
})

test('generic append cannot add duplicate identified records', () => {
  const current = { sections: { reputation: '<state:reputation><ent_rep><name>Fox</name><standing>Known</standing></ent_rep></state:reputation>' } }
  expect(() => applyStateDelta(current, { reputation: { ops: [{ op: 'append', path: [], xml: '<ent_rep><name>Fox</name><standing>Different</standing></ent_rep>' }] } })).toThrow()
})

test('generic memory operations cannot rewrite or duplicate an existing memory', () => {
  const current = { sections: { entityMem: '<state:entityMem><ent_mem><name>A</name><mem>Original</mem></ent_mem></state:entityMem>' } }
  expect(() => applyStateDelta(current, { entityMem: { ops: [{ op: 'set', path: ['ent_mem', 'mem'], value: 'Changed' }] } })).toThrow()
  expect(() => applyStateDelta(current, { entityMem: { ops: [{ op: 'append', path: ['ent_mem'], xml: '<mem>Original</mem>' }] } })).toThrow()
})

test('generic edits refuse missing or duplicate paths and malformed append fragments', () => {
  const current = { sections: { tracks: '<state:tracks><track><name>A</name><value>1</value></track><track><name>A</name><value>2</value></track></state:tracks>' } }
  for (const operations of [
    [{ op: 'set', path: ['track', 'value'], value: 'bad' }],
    [{ op: 'set', path: [{ tag: 'track', where: { tag: 'name', value: 'A' } }, 'value'], value: 'bad' }],
    [{ op: 'set', path: ['missing'], value: 'bad' }],
    [{ op: 'append', path: [], xml: '<track>' }],
    [{ op: 'append', path: [], xml: '<state:world />' }],
    [{ op: 'set', path: [], value: 'bad' }],
    [{ op: 'set', path: ['track'], value: 'bad', ignored: true }],
  ]) expect(() => applyStateDelta(current, { tracks: { operations } })).toThrow()
  expect(current.sections.tracks).toContain('<value>1</value>')
})

test('incomplete XML and trailing material around replacement sections are rejected', () => {
  const current = { sections: { world: '<state:world/>' } }
  for (const world of [
    '<state:world><x>&bogus;</x></state:world>',
    ' <state:world/> ',
    '<state:world><x>\ud800</x></state:world>',
    '<state:world><![CDATA[\u0001]]></state:world>',
  ]) expect(() => applyStateDelta(current, { world })).toThrow()
})

test('persisted envelope cannot hide state omitted from the section map', () => {
  const current = { sections: { world: '<state:world/>' }, envelope: '<internal_states><state:world/><state:inv><inv>secret</inv></state:inv></internal_states>' }
  expect(() => applyStateDelta(current, { world: { fields: { time: 'noon' } } })).toThrow()
})

test('empty record and memory operations do not invent missing sections', () => {
  const current = { sections: {} }
  const next = applyStateDelta(current, { offscreen_agendas: { records: [] }, entityMem: { append: [] }, world: { fields: {} } })
  expect(next.sections).toEqual({})
})

test('delta validation is atomic and rejects extra operations, malformed XML and prototypes', () => {
  const current = { sections: { world: '<state:world><time>morning</time></state:world>' } }
  const attacks: unknown[] = [
    null, [], 'bad',
    { world: '<state:world><time>bad</state:world>' },
    { world: '<state:world><time>ok</time></state:world><state:world>bad</state:world>' },
    { world: { fields: { time: 'noon' }, ignored: 'data' } },
    { world: { fields: { time: 'noon', bogus: 'bad' } } },
    JSON.parse('{"__proto__":{"polluted":true}}'),
    Object.create({ world: { fields: { time: 'evil' } } }),
  ]
  for (const attack of attacks) expect(() => applyStateDelta(current, attack as Record<string, unknown>)).toThrow()
  expect(current.sections.world).toBe('<state:world><time>morning</time></state:world>')
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
})

test('field patch escapes arbitrary text and rejects unrecognized fields', () => {
  const current = migrateLastInternalState([{role:'assistant', content:'<internal_states><state:world><ct>1</ct><time>morning</time><weather>rain</weather></state:world></internal_states>'}])
  const updated = applyStateDelta(current, { world: { fields: { ct: 2, weather: 'Rain & wind <strong>' } } })
  expect(updated.sections.world).toContain('<ct>2</ct>')
  expect(updated.sections.world).toContain('Rain &amp; wind &lt;strong&gt;')
  expect(() => applyStateDelta(current, { world: { fields: { arbitrary: 'bad' } } })).toThrow(/arbitrary/)
  const offscreen = { sections: { offscreen_agendas: '<state:offscreen_agendas><ent_off><name>Fox</name><loc>Harbor</loc></ent_off></state:offscreen_agendas>' } }
  const echoed = applyStateDelta(offscreen, { offscreen_agendas: { records: [{ name: 'Fox', fields: { name: 'Fox', loc: 'Market' } }] } })
  expect(echoed.sections.offscreen_agendas).toContain('<loc>Market</loc>')
  expect(() => applyStateDelta(offscreen, { offscreen_agendas: { records: [{ name: 'Fox', fields: { name: 'Other', loc: 'Market' } }] } })).toThrow(/name/)
  // Accepts section-specific identity aliases (pair/names) and flat record fields, while rejecting unknown keys
  const flatDam = applyStateDelta({ sections: {} }, {
    dam: { records: [{ pair: 'Grid→Kris', sluice: 'E:s L:s', intent: 'Push him out' }] },
    pair: { records: [{ names: 'Grid↔Kris', fields: { mode: 'HOSTILE', wall: 'Betrayal' } }] },
  })
  expect(flatDam.sections.dam).toContain('<pair>Grid→Kris</pair><sluice>E:s L:s</sluice>')
  expect(flatDam.sections.pair).toContain('<names>Grid↔Kris</names><mode>HOSTILE</mode>')
  expect(() => applyStateDelta(offscreen, { offscreen_agendas: { records: [{ name: 'Fox', bogusKey: 'nope' }] } })).toThrow(/bogusKey/)
})
