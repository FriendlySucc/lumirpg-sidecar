import { expect, test } from 'bun:test'
import { applyAnalyzeState, projectAnalyzeState } from '../src/analyze-state.js'
import { migrateLastInternalState, renderStateForPrompt, STATE_SECTIONS } from '../src/internal-state.js'

test('a migrated snapshot exposes only decoded schema fields; an empty or same-value edit is byte-exact', () => {
  const ledger = '<details class="ldg-source"><activation>DORMANT</activation><stat>private</stat></details>'
  const envelope = `<internal_states xmlns:state="urn:vexa" rev='3'>\n<!-- envelope metadata -->\n<state:vent/>\n<state:world old='yes'><ct>2&#56;</ct><!-- secret --><loc> A &#38; B </loc><legacy>private</legacy><time>before<ledger>private</ledger></time><room source="hidden" /></state:world>\n</internal_states>`
  const source = `${envelope}\n${ledger}`
  const current = migrateLastInternalState([{ role: 'assistant', content: `Story\n${source}` }])
  const view = projectAnalyzeState(current)
  expect(JSON.parse(JSON.stringify(view))).toEqual({ vent: {}, world: { ct: '28', loc: ' A & B ', room: '' } })
  for (const patch of [{}, { world: { ct: '28', loc: ' A & B ' } }, { inv: {} }]) {
    const next = applyAnalyzeState(current, patch)
    expect(next).toEqual(current)
    expect(renderStateForPrompt(next)).toBe(source)
  }
  const next = applyAnalyzeState(current, { world: { ct: '29', room: 'Hall & yard', user_pos: 'x < 3' } })
  expect(renderStateForPrompt(next)).toBe(source.replace('2&#56;', '29')
    .replace('<room source="hidden" />', '<room source="hidden" >Hall &amp; yard</room><user_pos>x &lt; 3</user_pos>'))
  expect(renderStateForPrompt(current)).toBe(source)
})

test('exact decoded keys select named rows; differences in spacing and DAM direction remain meaningful', () => {
  const on = `<state:onscreen><!--row order--><ent_on><name>Kris Lyons</name><why>stay</why></ent_on><ent_on v='3'><name> Kris&#32;Lyons </name><why>wait</why></ent_on></state:onscreen>`
  const dam = '<state:dam><ent_dam><pair>A→B</pair><intent>help</intent></ent_dam><ent_dam><pair>B→A</pair><intent>doubt</intent></ent_dam></state:dam>'
  const current = { sections: { onscreen: on, dam } }
  const next = applyAnalyzeState(current, {
    onscreen: { ' Kris Lyons ': { residualMood: 'shaken' }, 'A & B': { agenda: 'rest' } },
    dam: { 'B→A': { intent: 'listen' } }, pair: { 'A↔B': { mode: 'WARM' } },
  })
  expect(next.sections.onscreen).toBe(on.replace('<why>wait</why>', '<why>wait</why><residualMood>shaken</residualMood>')
    .replace('</state:onscreen>', '<ent_on><name>A &amp; B</name><agenda>rest</agenda></ent_on></state:onscreen>'))
  expect(next.sections.dam).toBe(dam.replace('doubt', 'listen'))
  expect(projectAnalyzeState(next)).toEqual({ onscreen: {
    'Kris Lyons': { why: 'stay' }, ' Kris Lyons ': { why: 'wait', residualMood: 'shaken' }, 'A & B': { agenda: 'rest' },
  }, dam: { 'A→B': { intent: 'help' }, 'B→A': { intent: 'listen' } }, pair: { 'A↔B': { mode: 'WARM' } } })
  expect(current.sections.onscreen).toBe(on)
})

test('witness arrays append only previously unseen exact facts, including for new witnesses', () => {
  const xml = '<state:entityMem><ent_mem><name>A</name><mem fmt="raw">Rain &#38; sun</mem><!--not a fact--><mem> A </mem></ent_mem></state:entityMem>'
  const current = { sections: { entityMem: xml } }
  const change = { entityMem: { A: ['Rain & sun', ' A ', 'New & true', 'New & true'], B: [' A '] } }
  const next = applyAnalyzeState(current, change)
  expect(projectAnalyzeState(next)).toEqual({ entityMem: { A: ['Rain & sun', ' A ', 'New & true'], B: [' A '] } })
  expect(next.sections.entityMem).toBe(xml.replace('</ent_mem>', '<mem>New &amp; true</mem></ent_mem><ent_mem><name>B</name><mem> A </mem></ent_mem>'))
  expect(applyAnalyzeState(next, change)).toEqual(next)
  expect(applyAnalyzeState({ sections: {} }, { entityMem: { A: [] } })).toEqual({ sections: {} })
})

test('a timeskip updates named tables and indexed lists, and appends even in missing nested groups', () => {
  const leads = '<state:leads note="kept"><usable/><active_leads n="2"><lead>Find Ada</lead><!-- same text, not same item --><lead fmt="v1">Find Ada</lead></active_leads></state:leads>'
  const tracks = '<state:tracks><main>Winter</main><track>Harvest | open</track><old><track>private</track></old><track>Ferry | open</track></state:tracks>'
  const rep = '<state:reputation><ent_rep n="1"><name>Ferry &#38; Co</name><standing>Wary</standing><buff>Ride free</buff></ent_rep></state:reputation>'
  const locs = '<state:locations><loc_rend><id>Fork</id><name>Old fork</name><dim>10m</dim></loc_rend></state:locations>'
  const current = { sections: { leads, tracks, reputation: rep, locations: locs, arc: '<state:arc><ki>Leaving</ki></state:arc>' } }
  const before = projectAnalyzeState(current)
  expect(before.leads).toEqual({ active_leads: ['Find Ada', 'Find Ada'], usable: [] })
  expect(before.tracks).toEqual({ main: 'Winter', track: ['Harvest | open', 'Ferry | open'] })
  expect(before.reputation).toEqual({ 'Ferry & Co': { standing: 'Wary', buff: 'Ride free' } })
  expect(before.locations).toEqual({ loc_rend: { Fork: { name: 'Old fork', dim: '10m' } } })

  const next = applyAnalyzeState(current, {
    leads: { active_leads: { append: ['Read the log'], '1': 'Found Ada' }, usable: { append: ['A ferry pass'] }, resolved_leads: { append: ['Crossing'] } },
    tracks: { main: 'Spring', track: { '0': 'Harvest | done', append: ['Sowing | open'] }, history: { append: ['Ice melted'] } },
    reputation: { 'Ferry & Co': { score: '+250', note: 'Kept promise' }, Guild: { standing: 'Neutral' } },
    locations: { loc_rend: { Fork: { occupants: 'Ada' }, Bridge: { name: 'North bridge', features: 'New arch' } }, loc_load: { Inn: { name: 'Inn', map_id: 'village' } } },
    arc: { timeline: 'After winter', sho: 'Return' }, chekhov: { chamber: { append: ['Letter'] }, locked: { append: ['Seal'] }, fired: { append: ['Bell rang'] } },
    notebook: { ent: { append: ['[T] Return'] }, note: { append: ['Older style note'] } },
  })
  expect(next.sections.leads).toBe(leads.replace('<lead fmt="v1">Find Ada</lead>', '<lead fmt="v1">Found Ada</lead><lead>Read the log</lead>')
    .replace('<usable/>', '<usable><lead>A ferry pass</lead></usable>').replace('</state:leads>', '<resolved_leads><lead>Crossing</lead></resolved_leads></state:leads>'))
  expect(next.sections.tracks).toBe(tracks.replace('Winter', 'Spring').replace('Harvest | open', 'Harvest | done')
    .replace('</state:tracks>', '<track>Sowing | open</track><history>Ice melted</history></state:tracks>'))
  expect(next.sections.reputation).toBe(rep.replace('</ent_rep>', '<score>+250</score><note>Kept promise</note></ent_rep><ent_rep><name>Guild</name><standing>Neutral</standing></ent_rep>'))
  expect(next.sections.locations).toContain('<dim>10m</dim><occupants>Ada</occupants></loc_rend><loc_rend><id>Bridge</id><name>North bridge</name>')
  const after = projectAnalyzeState(next)
  expect(after.locations.loc_load).toEqual({ Inn: { name: 'Inn', map_id: 'village' } })
  expect(after.chekhov).toEqual({ chamber: ['Letter'], locked: ['Seal'], fired: ['Bell rang'] })
  expect(after.arc).toEqual({ ki: 'Leaving', timeline: 'After winter', sho: 'Return' })
  expect(after.notebook).toEqual({ ent: ['[T] Return'], note: ['Older style note'] })
  const later = applyAnalyzeState(next, { leads: { active_leads: { '1': 'Asked Ada' } }, chekhov: { chamber: { '0': 'Opened letter' } } })
  expect(projectAnalyzeState(later).leads.active_leads).toEqual(['Find Ada', 'Asked Ada', 'Read the log'])
  expect(projectAnalyzeState(later).chekhov.chamber).toEqual(['Opened letter'])
  expect(current.sections.leads).toBe(leads)
})

test('the prompt contract documents each writable shape with sparse JSON examples', async () => {
  const { ANALYZE_STATE_FORMAT: format } = await import('../src/analyze-state.js')
  for (const section of STATE_SECTIONS) expect(format).toContain(section)
  for (const term of ['user_pos', 'residualMood', 'tQ5', 'matrix', 'loc_load', 'map_id', 'resolved_leads', 'history', '0-based', '"append":[', '"$from":"onscreen"']) expect(format).toContain(term)
  expect(format).not.toMatch(/<state:|"path"|"xml"/)
})

test('explicit opposite-roster transitions move exactly one original row and preserve its legacy bytes', () => {
  const kris = `<ent_on memo='x > y'><name>Kris&#32;Lyons</name><why>stay</why><!--keep--><residualMood>quiet</residualMood><old>value</old></ent_on >`
  const ada = '<ent_off><name>Ada</name><loc>Inn</loc></ent_off>'
  const on = `<state:onscreen>\n<!--before-->${kris}\n<ent_on><name>Kris</name><agenda>wait</agenda></ent_on></state:onscreen>`
  const off = `<state:offscreen_agendas><!--roster-->${ada}</state:offscreen_agendas>`
  const current = { sections: { onscreen: on, offscreen_agendas: off } }
  const enter = { Ada: { $from: 'offscreen_agendas', residualMood: 'ready' } }
  const exit = { 'Kris Lyons': { $from: 'onscreen', loc: 'Harbor', why: 'leave' } }
  const next = applyAnalyzeState(current, { onscreen: enter, offscreen_agendas: exit })
  expect(applyAnalyzeState(current, { offscreen_agendas: exit, onscreen: enter })).toEqual(next)
  expect(next.sections.onscreen).toBe(on.replace(kris, '').replace('</state:onscreen>', '<ent_on><name>Ada</name><loc>Inn</loc><residualMood>ready</residualMood></ent_on></state:onscreen>'))
  const movedKris = kris.replace('ent_on', 'ent_off').replace('stay', 'leave').replace('</ent_on >', '<loc>Harbor</loc></ent_off >')
  expect(next.sections.offscreen_agendas).toBe(off.replace(ada, movedKris))
  expect(projectAnalyzeState(next)).toEqual({ onscreen: { Ada: { residualMood: 'ready' }, Kris: { agenda: 'wait' } }, offscreen_agendas: { 'Kris Lyons': { loc: 'Harbor', why: 'leave' } } })
  const returned = applyAnalyzeState(next, { onscreen: { 'Kris Lyons': { $from: 'offscreen_agendas' } } })
  expect(projectAnalyzeState(returned).onscreen['Kris Lyons']).toEqual({ why: 'leave', residualMood: 'quiet' })
  expect(current.sections).toEqual({ onscreen: on, offscreen_agendas: off })
})

test('roster deletion, implicit copying, ambiguous moves and concurrent edits to the source all fail closed', () => {
  const current = { sections: { onscreen: '<state:onscreen><ent_on><name>A</name></ent_on></state:onscreen>' } }
  const exit = { A: { $from: 'onscreen', loc: 'Inn' } }
  const bad = [ { onscreen: { A: null } }, { onscreen: { A: { delete: true } } },
    { offscreen_agendas: { A: { loc: 'Inn' } } }, { offscreen_agendas: { B: { $from: 'onscreen' } } },
    { offscreen_agendas: { A: { $from: 'offscreen_agendas' } } }, { entity_state: { A: { $from: 'onscreen' } } },
    { offscreen_agendas: exit, onscreen: { A: { agenda: 'another edit' } } },
    { onscreen: { B: { why: 'new' } }, offscreen_agendas: { B: { loc: 'new' } } },
    { offscreen_agendas: { A: { $from: 'onscreen', name: 'B' } } },
  ]
  for (const patch of bad) expect(() => applyAnalyzeState(current, patch)).toThrow()
  const dup = { sections: { ...current.sections, offscreen_agendas: '<state:offscreen_agendas><ent_off><name>A</name></ent_off></state:offscreen_agendas>' } }
  expect(() => applyAnalyzeState(dup, { offscreen_agendas: exit })).toThrow()
})

test('plain text is distinct from markup, unknown fields, old ops, invalid characters and implicit clears', () => {
  const current = { sections: { world: '<state:world><time>early</time></state:world>', tracks: '<state:tracks><track>first</track></state:tracks>' } }
  const bad: unknown[] = [null, [], new Date(), 0, { sections: {} }, { ledger: {} }, { envelope: {} },
    { world: '<state:world/>' }, { world: { fields: { time: 'late' } } }, { world: { typo: 'new' } },
    { world: { ct: 29 } }, { world: { loc: null } }, { world: { audio: ' \n\t' } },
    { world: { time: '<time>late</time>' } }, { world: { time: 'bad\ud800' } }, { world: { time: '\u0001' } },
    { onscreen: { '<actor/>': { why: 'broken' } } }, { onscreen: { '   ': { why: 'broken' } } },
    { reputation: { Guild: { name: 'Other' } } }, { locations: { loc_rend: { Fork: { id: 'Other' } } } },
    { tracks: { ops: [{ op: 'set', path: ['main'], value: 'new' }] } }, { notebook: { ent: ['replacement'] } },
    { leads: { usable: { append: [{ xml: '<lead/>' }] } } }, { leads: { usable: { append: ['<ledger/>'] } } },
    { entityMem: { A: { '0': 'changed' } } }, { entityMem: { A: [''] } }, { entityMem: { A: ['<!--no-->'] } },
    ...['-1', '1', '01', '0.0', '1e0', ' 0', '9999999999999999999', 'delete', 'append'].map(key => ({ tracks: { track: { [key]: 'bad' } } })),
    JSON.parse('{"__proto__":{}}'), JSON.parse('{"entityMem":{"constructor":["x"]}}'),
    JSON.parse('{"reputation":{"X":{"prototype":"x"}}}'), Object.create({ world: { time: 'late' } }),
  ]
  for (const patch of bad) expect(() => applyAnalyzeState(current, patch)).toThrow()
  expect(() => applyAnalyzeState(current, { world: { time: 'late' }, entityMem: { A: [12] } })).toThrow()
  expect(current.sections.world).toBe('<state:world><time>early</time></state:world>')
  expect(applyAnalyzeState(current, { world: { time: 'a < b & c > d' } }).sections.world).toContain('a &lt; b &amp; c &gt; d')
})

test('rejects non-JSON array properties, accessors, sparse arrays and foreign prototypes without executing them', () => {
  let reads = 0
  const accessor = Object.defineProperty(['one'], '0', { enumerable: true, get() { reads++; return 'new' } })
  const unusual = Object.assign(['one'], { extra: 1 })
  const values = [accessor, unusual, Array(2), Object.assign(['a'], { [Symbol('meta')]: 1 }), Object.setPrototypeOf(['x'], Object.create(Array.prototype))]
  for (const array of values) {
    for (const patch of [{ entityMem: { A: array } }, { leads: { usable: { append: array } } }]) {
      expect(() => applyAnalyzeState({ sections: {} }, patch)).toThrow()
    }
  }
  const trap = Object.defineProperty({}, 'loc', { enumerable: true, get() { reads++; return 'elsewhere' } })
  expect(() => applyAnalyzeState({ sections: {} }, { world: trap })).toThrow()
  expect(reads).toBe(0)
})

test('duplicate identities, singleton fields or containers never silently choose a winner', () => {
  const cases = [
    ['entityMem', '<ent_mem><name>A</name></ent_mem><ent_mem><name>&#65;</name></ent_mem>', { A: ['x'] }],
    ['offscreen_agendas', '<ent_off><name>A</name><name>B</name></ent_off>', { A: { loc: 'Inn' } }],
    ['reputation', '<ent_rep><standing>Wary</standing></ent_rep>', { A: { score: '0' } }],
    ['locations', '<loc_rend><id>A</id></loc_rend><loc_rend><id>A</id></loc_rend>', { loc_rend: { A: { features: 'bridge' } } }],
    ['world', '<loc>A</loc><loc>B</loc>', { loc: 'C' }],
    ['leads', '<usable/><usable/>', { usable: { append: ['x'] } }],
  ] as const
  for (const [name, body, change] of cases) {
    const current = { sections: { [name]: `<state:${name}>${body}</state:${name}>` } }
    expect(() => projectAnalyzeState(current)).toThrow()
    expect(() => applyAnalyzeState(current, { [name]: change })).toThrow()
    expect(applyAnalyzeState(current, {})).toEqual(current)
  }
})

test('legacy text annotations are not facts; nested or markup-bearing values are isolated without shifting indices', () => {
  const world = `<state:world><time src='v1'><!--hint-->Before &#38; dawn<!--end--></time><weather><![CDATA[grey & damp]]></weather><audio>&lt;ledger&gt;secret&lt;/ledger&gt;</audio><room>lobby<private>secret</private></room></state:world>`
  const tracks = '<state:tracks><track>one</track><track><details class="ldg-source">secret</details></track><track>three</track></state:tracks>'
  const mem = '<state:entityMem><ent_mem><name><!--id-->A</name><mem><![CDATA[old & true]]></mem><mem><!--not a fact-->A&#38;B</mem><mem><ledger>secret</ledger></mem></ent_mem></state:entityMem>'
  const current = { sections: { world, tracks, entityMem: mem } }
  expect(projectAnalyzeState(current)).toEqual({ world: { time: 'Before & dawn', weather: 'grey & damp' }, tracks: { track: ['one', null, 'three'] }, entityMem: { A: ['old & true', 'A&B'] } })
  const next = applyAnalyzeState(current, { world: { time: 'Before & dusk', weather: 'dry' }, tracks: { track: { '2': 'updated', append: ['four'] } }, entityMem: { A: ['A&B', 'old & true', 'new'] } })
  expect(next.sections.world).toBe(world.replace('dawn', 'dusk').replace('grey & damp', 'dry'))
  expect(next.sections.tracks).toBe(tracks.replace('three</track>', 'updated</track><track>four</track>'))
  expect(next.sections.entityMem).toBe(mem.replace('</ent_mem>', '<mem>new</mem></ent_mem>'))
  for (const patch of [{ tracks: { track: { '1': 'overwrite' } } }, { world: { audio: 'overwrite' } }, { world: { room: 'overwrite' } }]) {
    expect(() => applyAnalyzeState(current, patch)).toThrow()
  }
})

test('empty edits do not seed absent groups; adding children must not hide non-placeholder legacy prose', () => {
  const absent = { sections: {} }
  expect(applyAnalyzeState(absent, { leads: { usable: { append: [] } }, entity_state: { A: {} }, notebook: {}, locations: { loc_load: {} } })).toEqual(absent)
  const current = { sections: { leads: '<state:leads><usable>Wait for summer</usable></state:leads>', vent: '<state:vent>Existing note</state:vent>' } }
  expect(() => applyAnalyzeState(current, { leads: { usable: { append: ['Arrived'] } } })).toThrow()
  expect(() => applyAnalyzeState(current, { vent: { vent: 'New note' } })).toThrow()
  const blank = { sections: { leads: '<state:leads><usable empty="true">∅<!--legacy--></usable></state:leads>' } }
  expect(applyAnalyzeState(blank, { leads: { usable: { append: ['Arrived'] } } }).sections.leads).toBe(blank.sections.leads.replace('</usable>', '<lead>Arrived</lead></usable>'))
})

test('all 18 canonical sections can be seeded, migrated and projected without a state or Ledger wrapper', () => {
  const directAndNamed = {
    world: { ct: '28', date: 'Nov 17' }, inv: { inv: 'Tea & bread', titles: 'Visitor', status: 'rested' },
    onscreen: { 'Kris⠀Lyons': { parrott: 'calm', residualMood: 'relief', move: 'sit' } },
    offscreen_agendas: { Jo: { loc: 'Port', mood: 'ready', goal: 'Deliver letter' } },
    entity_state: { Jo: { fontColor: '#abcdef', look: 'Hat', private: 'from the port' } },
    thoughts: { Jo: { tQ1: 'Return', tQ5: 'Tomorrow' } }, entityMem: { Jo: ['Saw a ferry'] },
    dam: { 'Jo→Kris⠀Lyons': { sluice: 'E:s L:o' } }, pair: { 'Kris⠀Lyons↔Jo': { wall: 'distance' } },
    locations: { loc_load: { '#17': { map_id: 'Docks' } } }, reputation: { Port: { standing: 'Trusted' } },
    arc: { info: 'Return', ten: 'Storm' }, story_notes: { GremlinNote: 'Ship', motives: 'Find Jo' }, vent: { vent: 'Stand by' },
  }
  const next = applyAnalyzeState({ sections: {} }, { ...directAndNamed, tracks: { main: 'Docks', track: { append: ['Wait'] } },
    leads: { active_leads: { append: ['Visit port'] } }, chekhov: { chamber: { append: ['Letter'] } }, notebook: { ent: { append: ['Tide out'] } } })
  expect(Object.keys(next.sections).sort()).toEqual([...STATE_SECTIONS].sort())
  const legacy = [{ role: 'assistant', content: '<internal_states><state:inv><inv>old</inv></state:inv></internal_states>' },
    { role: 'assistant', content: renderStateForPrompt(next) }]
  const restored = migrateLastInternalState(legacy)
  expect(projectAnalyzeState(restored)).toEqual({ ...directAndNamed, tracks: { main: 'Docks', track: ['Wait'] },
    leads: { active_leads: ['Visit port'] }, chekhov: { chamber: ['Letter'] }, notebook: { ent: ['Tide out'] } })
  expect(renderStateForPrompt(applyAnalyzeState(restored, { world: { ct: '29' } }))).toBe(legacy[1].content.replace('<ct>28</ct>', '<ct>29</ct>'))
})

test('an unambiguous edit within annotated text keeps the surrounding lexical runs; cross-comment rewrites fail', () => {
  const xml = `<state:world><ct>2<!--turns-->8</ct><loc>&#x1F6A2; A&#38;B</loc><pacing><![CDATA[steady]]></pacing></state:world>`
  const current = { sections: { world: xml } }
  const next = applyAnalyzeState(current, { world: { ct: '29', loc: '🚢 C&B', pacing: 'right ]]>' } })
  expect(next.sections.world).toContain('<ct>2<!--turns-->9</ct><loc>&#x1F6A2; C&#38;B</loc>')
  expect(projectAnalyzeState(next).world).toEqual({ ct: '29', loc: '🚢 C&B', pacing: 'right ]]>' })
  expect(() => applyAnalyzeState(current, { world: { ct: '37' } })).toThrow()
  for (const patch of [{ entityMem: { 'Bad\u0000name': [] } }, { reputation: { '\ud800': {} } }]) expect(() => applyAnalyzeState(current, patch)).toThrow()
})
