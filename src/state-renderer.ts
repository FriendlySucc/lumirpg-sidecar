/* ── Native Vexa-style GFX state renderers (pure safe DOM, zero innerHTML) ── */

export const LEDGER_ELEMENT = /^(?:(?:[\w.-]+:)?(?:details|ledger|activation)|ledger:[\w.-]+)$/i

const BRAILLE_SPACE = /\u2800+/g

function normText(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.replace(BRAILLE_SPACE, ' ').replace(/[ \t]+/g, ' ').trim()
}

function isEmptyVal(val: string): boolean {
  const t = normText(val)
  return !t || t === '∅' || t === 'Ø' || t === '—' || t === '-'
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function parseSectionXml(raw: string): { root: Element | null; blocked: boolean } {
  const input = raw.trim()
  if (!input || /<!\s*(?:DOCTYPE|ENTITY)/i.test(input)) return { root: null, blocked: false }
  try {
    const parser = new window.DOMParser()
    const parsed = parser.parseFromString(
      `<root xmlns:state="urn:lumi-atlas:state">${input}</root>`,
      'application/xml',
    )
    if (parsed.querySelector('parsererror')) return { root: null, blocked: false }
    const root = parsed.documentElement
    const stateEl = Array.from(root.children).find((c) => c.tagName.startsWith('state:'))
    if (stateEl && LEDGER_ELEMENT.test(stateEl.tagName)) return { root: null, blocked: true }
    const target = stateEl ?? root
    const clone = target.cloneNode(true) as Element
    for (const node of Array.from(clone.querySelectorAll('*'))) {
      if (LEDGER_ELEMENT.test(node.tagName)) node.remove()
    }
    return { root: clone, blocked: false }
  } catch {
    return { root: null, blocked: false }
  }
}

function childText(parent: Element, tag: string): string {
  for (const child of Array.from(parent.children)) {
    if (child.tagName.toLowerCase() === tag.toLowerCase()) {
      return normText(child.textContent)
    }
  }
  return ''
}

function childrenByTag(parent: Element, tag: string): Element[] {
  const lower = tag.toLowerCase()
  return Array.from(parent.children).filter((c) => c.tagName.toLowerCase() === lower)
}

function makeCollapsibleCard(
  opts: {
    cardId: string
    icon: string
    title: string
    titleCode?: string
    badge?: string
    accentColor?: string
    expandedCards: Set<string>
    onToggle: () => void
  },
  buildBody: (body: HTMLElement) => void,
): HTMLElement {
  const isExpanded = opts.expandedCards.has(opts.cardId)
  const card = el('div', `la-card${isExpanded ? ' la-card-open' : ''}`)
  const head = el('div', `la-card-head${isExpanded ? ' la-expanded' : ''}`)
  head.setAttribute('role', 'button')
  head.setAttribute('tabindex', '0')
  head.setAttribute('aria-expanded', String(isExpanded))

  const chevron = el('span', 'la-card-chevron', isExpanded ? '▾' : '▸')
  const iconEl = el('span', 'la-card-icon', opts.icon)
  if (opts.accentColor) iconEl.style.color = opts.accentColor

  const nameWrap = el('span', 'la-card-name')
  nameWrap.append(document.createTextNode(opts.title))
  if (opts.titleCode) {
    nameWrap.append(document.createTextNode(' '), el('code', 'la-loc-id', opts.titleCode))
  }

  head.append(chevron, iconEl, nameWrap)
  if (opts.badge) head.append(el('span', 'la-card-badge', opts.badge))
  card.append(head)

  if (isExpanded) {
    const body = el('div', 'la-card-body')
    buildBody(body)
    card.append(body)
  }

  const toggle = () => {
    if (opts.expandedCards.has(opts.cardId)) opts.expandedCards.delete(opts.cardId)
    else opts.expandedCards.add(opts.cardId)
    opts.onToggle()
  }
  head.addEventListener('click', toggle)
  head.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault()
      toggle()
    }
  })
  return card
}

function renderEmpty(container: HTMLElement, label: string): void {
  container.append(el('p', 'la-subtitle', `No ${label.toLowerCase()} data available.`))
}

/* ── 1. World HUD (flat) ── */
function renderWorld(root: Element, container: HTMLElement): boolean {
  const ct = childText(root, 'ct')
  const loc = childText(root, 'loc')
  const time = childText(root, 'time')
  const date = childText(root, 'date')
  const weather = childText(root, 'weather')
  const room = childText(root, 'room')
  const userPos = childText(root, 'user_pos')
  const entries = childText(root, 'entries')
  const obstacles = childText(root, 'obstacles')
  const audio = childText(root, 'audio')
  const pacing = childText(root, 'pacing')

  if (!ct && !loc && !time && !room && !userPos && !entries && !obstacles && !audio && !pacing) {
    return false
  }

  const hud = el('div', 'la-world-hud')
  if (ct || loc || time || date || weather || pacing) {
    const bar = el('div', 'la-world-bar')
    if (ct) bar.append(el('span', 'la-world-pill la-world-ct', `CT ${ct}`))
    if (time) bar.append(el('span', 'la-world-pill', `🕐 ${time}`))
    if (date) bar.append(el('span', 'la-world-pill', `📅 ${date}`))
    if (loc) bar.append(el('span', 'la-world-pill', `📍 ${loc}`))
    if (weather) bar.append(el('span', 'la-world-pill', `🌥 ${weather}`))
    if (pacing) bar.append(el('span', 'la-world-pill la-world-pacing', `⏱ ${pacing}`))
    hud.append(bar)
  }

  const addPanel = (icon: string, label: string, val: string, highlight = false) => {
    if (!val) return
    const box = el('div', `la-flat-panel${highlight ? ' la-flat-highlight' : ''}`)
    box.append(el('div', 'la-flat-badge', `${icon} ${label}`))
    box.append(el('div', 'la-flat-text', val))
    hud.append(box)
  }

  addPanel('👤', 'POSITION', userPos, true)
  addPanel('🎨', 'ROOM', room)
  addPanel('🚪', 'ENTRIES', entries)
  addPanel('🧱', 'OBSTACLES', obstacles)
  addPanel('🔊', 'AUDIO', audio)

  // Any extra unrecognized child elements
  const known = new Set(['ct', 'loc', 'time', 'date', 'weather', 'room', 'user_pos', 'entries', 'obstacles', 'audio', 'pacing'])
  for (const child of Array.from(root.children)) {
    if (known.has(child.tagName.toLowerCase())) continue
    const val = normText(child.textContent)
    if (val) addPanel('•', child.tagName.replace(/_/g, ' ').toUpperCase(), val)
  }

  container.append(hud)
  return true
}

/* ── 2. On-Screen characters (collapsible) ── */
function renderOnScreen(
  root: Element,
  container: HTMLElement,
  expandedCards: Set<string>,
  onToggle: () => void,
): boolean {
  const entries = childrenByTag(root, 'ent_on')
  if (!entries.length) {
    const t = normText(root.textContent)
    if (isEmptyVal(t)) {
      container.append(el('p', 'la-subtitle', 'Nobody else on-screen right now.'))
      return true
    }
    return false
  }
  for (const entry of entries) {
    const name = childText(entry, 'name') || 'Character'
    const sal = childText(entry, 'salience').replace(/^sal:\s*/i, '')
    const parrott = childText(entry, 'parrott')
    const residual = childText(entry, 'residualMood')
    const tfdy = childText(entry, 'tfdy')
    const agenda = childText(entry, 'agenda')
    const why = childText(entry, 'why')
    const end = childText(entry, 'end')
    const move = childText(entry, 'move')

    const card = makeCollapsibleCard(
      {
        cardId: `onscreen:${name}`,
        icon: '👤',
        title: name,
        badge: sal ? `SAL ${sal}` : undefined,
        accentColor: '#c084fc',
        expandedCards,
        onToggle,
      },
      (body) => {
        if (parrott || tfdy) {
          const bar = el('div', 'la-meta-bar')
          if (parrott) bar.append(el('span', 'la-meta-chip', parrott))
          if (tfdy) bar.append(el('span', 'la-meta-chip la-meta-mono', tfdy))
          body.append(bar)
        }
        if (residual) body.append(el('div', 'la-card-subtext', residual))
        for (const [k, v] of [
          ['AGENDA', agenda],
          ['WHY', why],
          ['END', end],
          ['MOVE', move],
        ] as const) {
          if (!v) continue
          const row = el('div', 'la-card-detail')
          row.append(el('div', 'la-card-detail-title', k), el('div', 'la-card-detail-text', v))
          body.append(row)
        }
      },
    )
    container.append(card)
  }
  return true
}

/* ── 3. Off-Screen agendas (collapsible) ── */
function renderOffScreen(
  root: Element,
  container: HTMLElement,
  expandedCards: Set<string>,
  onToggle: () => void,
): boolean {
  const entries = childrenByTag(root, 'ent_off')
  if (!entries.length) return false
  for (const entry of entries) {
    const name = childText(entry, 'name') || 'Character'
    const loc = childText(entry, 'loc')
    const sal = childText(entry, 'salience').replace(/^sal:\s*/i, '')
    const mood = childText(entry, 'mood').replace(/^Parrot(?:Mood|Emotion):\s*/i, '')
    const tfdy = childText(entry, 'tfdy')
    const agenda = childText(entry, 'agenda')
    const why = childText(entry, 'why')
    const goal = childText(entry, 'goal')
    const end = childText(entry, 'end')

    const card = makeCollapsibleCard(
      {
        cardId: `offscreen_agendas:${name}`,
        icon: '🌙',
        title: name,
        badge: sal ? `SIG ${sal}` : undefined,
        accentColor: '#c4973c',
        expandedCards,
        onToggle,
      },
      (body) => {
        if (loc) body.append(el('div', 'la-card-location', `📍 ${loc}`))
        if (mood || tfdy) {
          const bar = el('div', 'la-meta-bar')
          if (mood) bar.append(el('span', 'la-meta-chip', mood))
          if (tfdy) bar.append(el('span', 'la-meta-chip la-meta-mono', tfdy))
          body.append(bar)
        }
        for (const [k, v] of [
          ['AGENDA', agenda],
          ['WHY', why],
          ['GOAL', goal],
          ['END', end],
        ] as const) {
          if (!v) continue
          const row = el('div', 'la-card-detail')
          row.append(el('div', 'la-card-detail-title', k), el('div', 'la-card-detail-text', v))
          body.append(row)
        }
      },
    )
    container.append(card)
  }
  return true
}

/* ── 4. Locations (collapsible) ── */
function renderLocations(
  root: Element,
  container: HTMLElement,
  expandedCards: Set<string>,
  onToggle: () => void,
): boolean {
  const rendered = childrenByTag(root, 'loc_rend')
  const loaded = childrenByTag(root, 'loc_load')
  const all = [
    ...rendered.map((node) => ({ node, kind: 'Rendered' as const, icon: '📍' })),
    ...loaded.map((node) => ({ node, kind: 'Loaded' as const, icon: '◌' })),
  ]
  if (!all.length) return false

  for (const { node, kind, icon } of all) {
    const id = childText(node, 'id')
    const name = childText(node, 'name') || id || 'Location'
    const mapId = childText(node, 'map_id')
    const dim = childText(node, 'dim')
    const bbox = childText(node, 'bbox')
    const anchor = childText(node, 'anchor')
    const features = childText(node, 'features')
    const adj = childText(node, 'adj')
    const grid = childText(node, 'grid')
    const occupants = childText(node, 'occupants')
    const exits = childText(node, 'exits')
    const updated = childText(node, 'updated')

    const card = makeCollapsibleCard(
      {
        cardId: `locations:${id || name}`,
        icon,
        title: name,
        titleCode: id || undefined,
        badge: kind,
        accentColor: kind === 'Rendered' ? '#e86a6a' : '#8a8078',
        expandedCards,
        onToggle,
      },
      (body) => {
        const metaPairs: Array<[string, string]> = [
          ['Map', mapId],
          ['Dimensions', dim],
          ['Grid', grid],
          ['BBox', bbox],
          ['Anchor', anchor],
        ].filter(([, v]) => Boolean(v)) as Array<[string, string]>
        if (metaPairs.length) {
          const gridEl = el('div', 'la-kv-grid')
          for (const [k, v] of metaPairs) {
            const cell = el('div', 'la-kv-cell')
            cell.append(el('div', 'la-kv-k', k), el('div', 'la-kv-v', v))
            gridEl.append(cell)
          }
          body.append(gridEl)
        }
        for (const [k, v] of [
          ['FEATURES', features],
          ['OCCUPANTS', occupants],
          ['ADJACENT', adj],
          ['DOORWAYS', exits],
        ] as const) {
          if (!v || isEmptyVal(v)) continue
          const row = el('div', 'la-card-detail')
          row.append(el('div', 'la-card-detail-title', k), el('div', 'la-card-detail-text', v))
          body.append(row)
        }
        if (updated) body.append(el('div', 'la-card-footer', `Updated: ${updated}`))
      },
    )
    container.append(card)
  }
  return true
}

/* ── 5. Entity Memory (collapsible) ── */
function renderEntityMemory(
  root: Element,
  container: HTMLElement,
  expandedCards: Set<string>,
  onToggle: () => void,
): boolean {
  const entries = childrenByTag(root, 'ent_mem')
  if (!entries.length) return false

  for (const entry of entries) {
    const name = childText(entry, 'name') || 'Entity'
    const mems = childrenByTag(entry, 'mem')
    const card = makeCollapsibleCard(
      {
        cardId: `entityMem:${name}`,
        icon: '🧠',
        title: name,
        badge: mems.length ? `${mems.length} mem` : 'Knowledge',
        accentColor: '#e86a8a',
        expandedCards,
        onToggle,
      },
      (body) => {
        for (const memEl of mems) {
          const raw = normText(memEl.textContent)
          if (!raw) continue
          const match = raw.match(/^([\s\S]*?)\s*\|\s*T:\s*([^|]+?)\s*\|\s*V:\s*([^|]+?)\s*\|\s*C:\s*(.+)$/)
          const item = el('div', 'la-mem-entry')
          if (match) {
            item.append(el('div', 'la-mem-fact', match[1].trim()))
            const meta = el('div', 'la-meta-bar')
            meta.append(
              el('span', 'la-meta-chip', `🕐 ${match[2].trim()}`),
              el('span', 'la-meta-chip', `👁 ${match[3].trim()}`),
              el('span', 'la-meta-chip la-mem-cert', match[4].trim()),
            )
            item.append(meta)
          } else {
            item.append(el('div', 'la-mem-fact', raw))
          }
          body.append(item)
        }
      },
    )
    container.append(card)
  }
  return true
}

/* ── 6. Entity Profile (collapsible) ── */
function renderEntityProfile(
  root: Element,
  container: HTMLElement,
  expandedCards: Set<string>,
  onToggle: () => void,
): boolean {
  const entries = childrenByTag(root, 'ent_col')
  if (!entries.length) return false

  for (const entry of entries) {
    const name = childText(entry, 'name') || 'Entity'
    const fontColor = childText(entry, 'fontColor')
    const hexMatch = fontColor.match(/#[0-9a-fA-F]{6}/)
    const swatchHex = hexMatch ? hexMatch[0] : undefined
    const look = childText(entry, 'look')
    const voice = childText(entry, 'voice')
    const persona = childText(entry, 'persona')
    const priv = childText(entry, 'private')

    const card = makeCollapsibleCard(
      {
        cardId: `entity_state:${name}`,
        icon: '🪪',
        title: name,
        badge: 'Profile',
        accentColor: swatchHex ?? '#6a8ae8',
        expandedCards,
        onToggle,
      },
      (body) => {
        if (fontColor) {
          const row = el('div', 'la-color-row')
          const dot = el('span', 'la-color-swatch')
          if (swatchHex) dot.style.background = swatchHex
          row.append(dot, el('span', 'la-kv-k', 'Font color'), el('code', 'la-loc-id', fontColor))
          body.append(row)
        }
        for (const [k, v] of [
          ['APPEARANCE', look],
          ['VOICE', voice],
          ['PERSONALITY', persona],
          ['PRIVATE KNOWLEDGE', priv],
        ] as const) {
          if (!v) continue
          const row = el('div', 'la-card-detail')
          row.append(el('div', 'la-card-detail-title', k), el('div', 'la-card-detail-text', v))
          body.append(row)
        }
      },
    )
    container.append(card)
  }
  return true
}

/* ── 7. Thoughts BTS Interview (collapsible + Q1-Q5 staggered cards) ── */
const THOUGHT_QUESTIONS: Array<[string, string, string]> = [
  ['tQ1', 'Q1', "What's your goal right now?"],
  ['tQ2', 'Q2', 'How do you feel about what just happened?'],
  ['tQ3', 'Q3', 'Where is your mind right now?'],
  ['tQ4', 'Q4', 'Why do you care?'],
  ['tQ5', 'Q5', 'If you could speak your mind right now, what would you actually say?'],
]

function renderThoughts(
  root: Element,
  container: HTMLElement,
  expandedCards: Set<string>,
  onToggle: () => void,
): boolean {
  const entries = childrenByTag(root, 'ent_think')
  if (!entries.length) return false

  for (const entry of entries) {
    const name = childText(entry, 'name') || 'Character'
    const card = makeCollapsibleCard(
      {
        cardId: `thoughts:${name}`,
        icon: '💭',
        title: name,
        badge: 'BTS INTERVIEW',
        accentColor: '#a78bfa',
        expandedCards,
        onToggle,
      },
      (body) => {
        let idx = 0
        for (const [tag, qLabel, question] of THOUGHT_QUESTIONS) {
          const answer = childText(entry, tag)
          if (!answer) continue
          idx++
          const qa = el('div', `la-qa-card ${idx % 2 === 0 ? 'la-qa-even' : 'la-qa-odd'}`)
          const qHead = el('div', 'la-qa-head')
          qHead.append(el('span', 'la-qa-badge', qLabel), el('span', 'la-qa-question', question))
          qa.append(qHead, el('div', 'la-qa-answer', answer))
          body.append(qa)
        }
      },
    )
    container.append(card)
  }
  return true
}

/* ── 8. Dams (collapsible + SLUICES / FLAGS / 2x2 FILTERS / INTENT) ── */
function normalizeFilterCode(code: string): 'HARD' | 'CRACK' | 'LIMIT' | 'OPEN' | '' {
  const c = code.trim().toLowerCase()
  if (c === 'h' || c === 'hard') return 'HARD'
  if (c === 'c' || c === 'crack' || c === 'cracked') return 'CRACK'
  if (c === 'r' || c === 'limit' || c === 'restricted') return 'LIMIT'
  if (c === 'o' || c === 'open') return 'OPEN'
  return ''
}

function renderDams(
  root: Element,
  container: HTMLElement,
  expandedCards: Set<string>,
  onToggle: () => void,
): boolean {
  const entries = childrenByTag(root, 'ent_dam')
  if (!entries.length) return false

  for (const entry of entries) {
    const pair = childText(entry, 'pair') || childText(entry, 'name') || 'Relationship'
    const sluiceRaw = childText(entry, 'sluice')
    const filtersRaw = childText(entry, 'filters')
    const miscRaw = childText(entry, 'misc')
    const intentRaw = childText(entry, 'intent').replace(/^intent:\s*/i, '')

    const eSluice = sluiceRaw.match(/E:\s*([a-z-]+)/i)?.[1]?.toLowerCase() ?? ''
    const lSluice = sluiceRaw.match(/L:\s*([a-z-]+)/i)?.[1]?.toLowerCase() ?? ''
    const clashVal = miscRaw.match(/clash:\s*([^|\s]+)/i)?.[1]?.toLowerCase() ?? ''
    const tensionVal = miscRaw.match(/T:\s*([^|\s]+)/i)?.[1]?.toLowerCase() ?? ''
    const isClash = clashVal === 'yes' || (clashVal !== '' && clashVal !== 'no' && clashVal !== '—' && clashVal !== '-' && clashVal !== '∅')
    const isTension = tensionVal === 'yes'

    const parseFilter = (key: string) => {
      const m = filtersRaw.match(new RegExp(`${key}:\\s*\\[?(hard|cracked|restricted|open|[hcro])\\]?\\s*((?:\\([^)]*\\)\\s*)*)`, 'i'))
      return {
        state: m ? normalizeFilterCode(m[1]) : '',
        note: m?.[2]?.trim() ?? '',
      }
    }
    const filterItems = [
      { name: 'SOCIAL', ...parseFilter('Soc') },
      { name: 'VALUES', ...parseFilter('Val') },
      { name: 'COMPETENCE', ...parseFilter('Comp') },
      { name: 'RELATIONSHIP', ...parseFilter('Rel') },
    ]

    const card = makeCollapsibleCard(
      {
        cardId: `dam:${pair}`,
        icon: '🪵',
        title: pair,
        badge: 'DIRECTIONAL',
        accentColor: '#c4973c',
        expandedCards,
        onToggle,
      },
      (body) => {
        const topRow = el('div', 'la-dam-top')

        // SLUICES block
        const sluiceBox = el('div', 'la-dam-block')
        sluiceBox.append(el('div', 'la-dam-block-title', 'SLUICES'))
        for (const [label, st] of [['E · EMOTION', eSluice], ['L · LANGUAGE', lSluice]] as const) {
          const row = el('div', 'la-dam-ctrl')
          row.append(el('div', 'la-dam-ctrl-name', label))
          const opts = el('div', 'la-dam-opts')
          const isOpen = st === 'open' || st === 'o'
          const isSealed = st === 'sealed' || st === 's'
          opts.append(
            el('span', `la-dam-opt${isSealed ? ' la-opt-amber' : ''}`, 'SEALED'),
            el('span', `la-dam-opt${isOpen ? ' la-opt-green' : ''}`, 'OPEN'),
          )
          row.append(opts)
          sluiceBox.append(row)
        }
        topRow.append(sluiceBox)

        // FLAGS block
        const flagBox = el('div', 'la-dam-block')
        flagBox.append(el('div', 'la-dam-block-title', 'FLAGS'))
        for (const [label, active] of [['CLASH', isClash], ['TENSION', isTension]] as const) {
          const row = el('div', 'la-dam-ctrl')
          row.append(el('div', 'la-dam-ctrl-name', label))
          const opts = el('div', 'la-dam-opts')
          opts.append(
            el('span', `la-dam-opt${!active ? ' la-opt-neutral' : ''}`, 'NO'),
            el('span', `la-dam-opt${active ? ' la-opt-red' : ''}`, 'YES'),
          )
          row.append(opts)
          flagBox.append(row)
        }
        topRow.append(flagBox)
        body.append(topRow)

        // FILTERS 2x2 grid
        const filterBox = el('div', 'la-dam-block')
        filterBox.append(el('div', 'la-dam-block-title', 'FILTERS · HARD / CRACKED / RESTRICTED / OPEN'))
        const grid = el('div', 'la-dam-filter-grid')
        for (const f of filterItems) {
          const cell = el('div', 'la-dam-filter-cell')
          const head = el('div', 'la-dam-filter-head')
          head.append(el('span', 'la-dam-ctrl-name', f.name))
          if (f.note) head.append(el('span', 'la-dam-counter', f.note))
          cell.append(head)
          const opts = el('div', 'la-dam-opts la-dam-opts-4')
          for (const opt of ['HARD', 'CRACK', 'LIMIT', 'OPEN'] as const) {
            const activeClass =
              f.state !== opt
                ? ''
                : opt === 'HARD'
                  ? ' la-opt-red'
                  : opt === 'CRACK'
                    ? ' la-opt-amber'
                    : opt === 'LIMIT'
                      ? ' la-opt-blue'
                      : ' la-opt-green'
            opts.append(el('span', `la-dam-opt${activeClass}`, opt))
          }
          cell.append(opts)
          grid.append(cell)
        }
        filterBox.append(grid)
        body.append(filterBox)

        if (intentRaw) {
          const intentEl = el('div', 'la-dam-intent')
          intentEl.append(
            el('span', 'la-dam-intent-label', '🎯 INTENT '),
            el('span', 'la-dam-intent-text', intentRaw),
          )
          body.append(intentEl)
        }
      },
    )
    container.append(card)
  }
  return true
}

/* ── 9. Pairs (collapsible + 6 bidirectional opposing metric bars) ── */
interface PairAxisDef {
  negEmoji: string
  negLabel: string
  negColor: string
  posEmoji: string
  posLabel: string
  posColor: string
}

const PAIR_AXES: PairAxisDef[] = [
  { negEmoji: '😠', negLabel: 'Hatred', negColor: '#e87a6a', posEmoji: '🌶️', posLabel: 'Desire', posColor: '#f08868' },
  { negEmoji: '🥊', negLabel: 'Conflict', negColor: '#f08a9a', posEmoji: '🎲', posLabel: 'Play', posColor: '#e8c44e' },
  { negEmoji: '❄️', negLabel: 'Hostility', negColor: '#7ec8f0', posEmoji: '🤝', posLabel: 'Friendship', posColor: '#8aa8d8' },
  { negEmoji: '🪨', negLabel: 'Stagnation', negColor: '#a89cf0', posEmoji: '🛠️', posLabel: 'Commitment', posColor: '#e8a84e' },
  { negEmoji: '🌫️', negLabel: 'Indifference', negColor: '#98a0a8', posEmoji: '🏠', posLabel: 'Warmth', posColor: '#e8b878' },
  { negEmoji: '🐍', negLabel: 'Envy', negColor: '#88c888', posEmoji: '🕊️', posLabel: 'Devotion', posColor: '#c8d8f0' },
]

function parseMatrixTokens(raw: string): Map<string, { val: number; acc: string }> {
  const map = new Map<string, { val: number; acc: string }>()
  const re = /([^\s\[\]]+)\s*\[\s*([+-]?\d+)\s*,\s*([^\]]+?)\s*\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    const key = m[1].replace(/\uFE0F/g, '')
    map.set(key, { val: parseInt(m[2], 10) || 0, acc: m[3].trim() })
  }
  return map
}

function renderPairs(
  root: Element,
  container: HTMLElement,
  expandedCards: Set<string>,
  onToggle: () => void,
): boolean {
  const entries = childrenByTag(root, 'pair')
  if (!entries.length) return false

  for (const entry of entries) {
    const names = childText(entry, 'names') || childText(entry, 'name') || 'Pair'
    const mode = childText(entry, 'mode').replace(/^mode:\s*/i, '')
    const damRaw = childText(entry, 'dam')
    const matrixRaw = childText(entry, 'matrix')
    const wallRaw = childText(entry, 'wall').replace(/^wall:\s*/i, '')

    const eVal = damRaw.match(/E:\s*([^\s]+)/i)?.[1]
    const lVal = damRaw.match(/L:\s*([^\s]+)/i)?.[1]
    const gateVal = damRaw.match(/Gate:\s*([^\s]+)/i)?.[1]
    const tokens = parseMatrixTokens(matrixRaw)

    const card = makeCollapsibleCard(
      {
        cardId: `pair:${names}`,
        icon: '💚',
        title: names,
        badge: mode || 'PAIR',
        accentColor: '#4ade80',
        expandedCards,
        onToggle,
      },
      (body) => {
        if (eVal || lVal || gateVal) {
          const chips = el('div', 'la-meta-bar')
          if (eVal) chips.append(el('span', 'la-meta-chip', `E · ${eVal}`))
          if (lVal) chips.append(el('span', 'la-meta-chip', `L · ${lVal}`))
          if (gateVal) chips.append(el('span', 'la-meta-chip', `Gate · ${gateVal}`))
          body.append(chips)
        }

        if (tokens.size > 0) {
          const stack = el('div', 'la-axis-stack')
          for (const axis of PAIR_AXES) {
            const neg = tokens.get(axis.negEmoji.replace(/\uFE0F/g, '')) ?? { val: 0, acc: '0' }
            const pos = tokens.get(axis.posEmoji.replace(/\uFE0F/g, '')) ?? { val: 0, acc: '0' }
            const row = el('div', 'la-axis-row')

            const labels = el('div', 'la-axis-labels')
            const leftLbl = el('span', 'la-axis-side la-axis-neg')
            leftLbl.style.color = axis.negColor
            leftLbl.append(
              document.createTextNode(`${axis.negEmoji} ${axis.negLabel} `),
              el('strong', undefined, String(neg.val)),
              el('small', 'la-axis-acc', ` acc ${neg.acc}`),
            )
            const rightLbl = el('span', 'la-axis-side la-axis-pos')
            rightLbl.style.color = axis.posColor
            rightLbl.append(
              document.createTextNode(`${axis.posEmoji} ${axis.posLabel} `),
              el('strong', undefined, String(pos.val)),
              el('small', 'la-axis-acc', ` acc ${pos.acc}`),
            )
            labels.append(leftLbl, rightLbl)

            const track = el('div', 'la-axis-track')
            const negHalf = el('div', 'la-axis-half la-axis-half-neg')
            const negFill = el('div', 'la-axis-fill')
            negFill.style.width = `${Math.min(100, Math.max(0, neg.val) * 6.5)}%`
            negFill.style.background = axis.negColor
            negHalf.append(negFill)

            const posHalf = el('div', 'la-axis-half la-axis-half-pos')
            const posFill = el('div', 'la-axis-fill')
            posFill.style.width = `${Math.min(100, Math.max(0, pos.val) * 6.5)}%`
            posFill.style.background = axis.posColor
            posHalf.append(posFill)

            track.append(negHalf, el('div', 'la-axis-center'), posHalf)
            row.append(labels, track)
            stack.append(row)
          }
          body.append(stack)
        } else if (matrixRaw) {
          body.append(el('div', 'la-card-detail-text', matrixRaw))
        }

        if (wallRaw && !isEmptyVal(wallRaw)) {
          body.append(el('div', 'la-card-footer', `Wall: ${wallRaw}`))
        }
      },
    )
    container.append(card)
  }
  return true
}

/* ── 10. Tracks (flat) ── */
function renderTracks(root: Element, container: HTMLElement): boolean {
  const mains = childrenByTag(root, 'main')
  const tracks = childrenByTag(root, 'track')
  const histories = childrenByTag(root, 'history')
  if (!mains.length && !tracks.length && !histories.length) return false

  for (const m of mains) {
    const text = normText(m.textContent)
    if (!text || isEmptyVal(text)) continue
    const box = el('div', 'la-flat-panel la-flat-highlight')
    box.append(el('div', 'la-flat-badge', '🧵 MAIN TRACK'), el('div', 'la-flat-text', text))
    container.append(box)
  }
  for (const tr of tracks) {
    const text = normText(tr.textContent)
    if (!text || isEmptyVal(text)) continue
    const parts = text.split('|').map((s) => s.trim()).filter(Boolean)
    const box = el('div', 'la-flat-panel')
    if (parts.length >= 2) {
      const head = el('div', 'la-flat-row-head')
      head.append(el('span', 'la-flat-title', parts[0]))
      head.append(el('span', 'la-card-badge', parts[1]))
      box.append(head)
      if (parts.length > 2) box.append(el('div', 'la-flat-text', parts.slice(2).join(' · ')))
    } else {
      box.append(el('div', 'la-flat-text', text))
    }
    container.append(box)
  }
  for (const h of histories) {
    const text = normText(h.textContent)
    if (!text || isEmptyVal(text)) continue
    const box = el('div', 'la-flat-panel')
    box.append(el('div', 'la-flat-badge', '📜 HISTORY'), el('div', 'la-flat-text', text))
    container.append(box)
  }
  if (!container.children.length) renderEmpty(container, 'tracks')
  return true
}

/* ── 11. Arc (flat) ── */
function renderArc(root: Element, container: HTMLElement): boolean {
  const fields: Array<[string, string]> = [
    ['info', 'ARC OVERVIEW'],
    ['timeline', 'TIMELINE'],
    ['ki', 'KI · 起'],
    ['sho', 'SHŌ · 承'],
    ['ten', 'TEN · 転'],
    ['ketsu', 'KETSU · 結'],
  ]
  let anyFound = false
  for (const [tag, label] of fields) {
    const val = childText(root, tag)
    if (!val || isEmptyVal(val)) continue
    anyFound = true
    const box = el('div', 'la-flat-panel')
    box.append(el('div', 'la-flat-badge', label), el('div', 'la-flat-text', val))
    container.append(box)
  }
  if (!anyFound) {
    if (childrenByTag(root, 'info').length || childrenByTag(root, 'ki').length) {
      renderEmpty(container, 'arc')
      return true
    }
    return false
  }
  return true
}

/* ── 12. Chekhov (flat grouped) ── */
function renderChekhov(root: Element, container: HTMLElement): boolean {
  const groups: Array<[string, string]> = [
    ['chamber', '◉ CHAMBER'],
    ['locked', '🔒 LOCKED'],
    ['fired', '✦ FIRED THIS TURN'],
  ]
  let matched = false
  for (const [tag, title] of groups) {
    const sec = childrenByTag(root, tag)[0]
    if (!sec) continue
    matched = true
    const bullets = childrenByTag(sec, 'bullet')
    const texts = bullets.length
      ? bullets.map((b) => normText(b.textContent)).filter((t) => !isEmptyVal(t))
      : [normText(sec.textContent)].filter((t) => !isEmptyVal(t))
    if (!texts.length) continue
    const group = el('div', 'la-flat-group')
    group.append(el('div', 'la-flat-group-title', title))
    for (const t of texts) {
      const item = el('div', 'la-flat-panel')
      item.append(el('div', 'la-flat-text', t))
      group.append(item)
    }
    container.append(group)
  }
  if (matched && !container.children.length) renderEmpty(container, 'chekhov')
  return matched
}

/* ── 13. Leads (flat grouped) ── */
function renderLeads(root: Element, container: HTMLElement): boolean {
  const groups: Array<[string, string]> = [
    ['active_leads', '📌 ACTIVE LEADS & JOBS'],
    ['usable', '🔑 CONTACTS, LEVERAGE & HOOKS'],
    ['resolved_leads', '✓ RESOLVED THIS TURN'],
  ]
  let matched = false
  for (const [tag, title] of groups) {
    const sec = childrenByTag(root, tag)[0]
    if (!sec) continue
    matched = true
    const leads = childrenByTag(sec, 'lead')
    const texts = leads.length
      ? leads.map((l) => normText(l.textContent)).filter((t) => !isEmptyVal(t))
      : [normText(sec.textContent)].filter((t) => !isEmptyVal(t))
    if (!texts.length) continue
    const group = el('div', 'la-flat-group')
    group.append(el('div', 'la-flat-group-title', title))
    for (const t of texts) {
      const parts = t.split('|').map((s) => s.trim()).filter(Boolean)
      const item = el('div', 'la-flat-panel')
      if (parts.length >= 3) {
        const head = el('div', 'la-flat-row-head')
        head.append(el('span', 'la-flat-title', parts[0]), el('span', 'la-flat-meta', `· ${parts[1]}`))
        item.append(head, el('div', 'la-flat-text', parts.slice(2).join(' | ')))
      } else {
        item.append(el('div', 'la-flat-text', t))
      }
      group.append(item)
    }
    container.append(group)
  }
  if (matched && !container.children.length) renderEmpty(container, 'leads')
  return matched
}

/* ── 14. Inventory (structured sorted items + traits/status chips, zero truncation) ── */
function splitTopLevel(raw: string): string[] {
  const parts: string[] = []
  let buf = ''
  let depth = 0
  for (const ch of raw) {
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
      buf += ch
    } else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth > 0) depth--
      buf += ch
    } else if ((ch === ',' || ch === ';') && depth === 0) {
      const trimmed = buf.trim()
      if (trimmed) parts.push(trimmed)
      buf = ''
    } else {
      buf += ch
    }
  }
  const tail = buf.trim()
  if (tail) parts.push(tail)
  return parts
}

const CURRENCY_RE = /^(?:[$€£¥₩]\s*\d|\d[\d.,]*\s*(?:eddies|eb|eurodollars?|credits?|gold|gp|sp|cp|coins?|yen|dollars?|bucks|caps|gil|septims?)\b)/i

function parseItemEntry(raw: string): { main: string; detail: string; subItems: string[] } {
  const match = raw.match(/^([^(]+?)\s*\(([\s\S]+)\)\s*$/)
  if (!match) return { main: raw, detail: '', subItems: [] }
  const main = match[1].trim()
  const inner = match[2].trim()
  // If inner has a colon followed by a multi-item list (e.g. "containing waxed canvas tool wrap: a, b, c"), split it
  const colonIdx = inner.indexOf(':')
  if (colonIdx > 0) {
    const prefix = inner.slice(0, colonIdx + 1).trim()
    const rest = inner.slice(colonIdx + 1).trim()
    const sub = splitTopLevel(rest)
    if (sub.length >= 2) {
      return { main, detail: prefix, subItems: sub }
    }
  }
  return { main, detail: inner, subItems: [] }
}

function renderInventory(root: Element, container: HTMLElement): boolean {
  const slots: Array<[string, string, string]> = [
    ['inv', '🎒', 'ITEMS'],
    ['titles', '🏷️', 'TRAITS'],
    ['status', '♥', 'STATUS'],
  ]
  let matched = false
  for (const [tag, icon, label] of slots) {
    const val = childText(root, tag)
    if (!val) continue
    matched = true
    const box = el('div', 'la-flat-panel')
    box.append(el('div', 'la-flat-badge', `${icon} ${label}`))

    const entries = splitTopLevel(val)
    if (tag === 'inv' && entries.length > 1) {
      const currency: string[] = []
      const containers: Array<{ main: string; detail: string; subItems: string[] }> = []
      const regular: Array<{ main: string; detail: string; subItems: string[] }> = []
      for (const entry of entries) {
        if (CURRENCY_RE.test(entry)) {
          currency.push(entry)
        } else {
          const parsed = parseItemEntry(entry)
          if (parsed.subItems.length > 0 || parsed.detail) containers.push(parsed)
          else regular.push(parsed)
        }
      }
      if (currency.length) {
        const curRow = el('div', 'la-inv-currency-row')
        for (const c of currency) curRow.append(el('span', 'la-inv-currency', `💰 ${c}`))
        box.append(curRow)
      }
      const list = el('div', 'la-inv-list')
      // Put simple carried items together, then containers/detailed items, alphabetically within each group
      const sortedRegular = [...regular].sort((a, b) => a.main.localeCompare(b.main))
      const sortedContainers = [...containers].sort((a, b) => a.main.localeCompare(b.main))
      for (const item of [...sortedRegular, ...sortedContainers]) {
        const row = el('div', 'la-inv-item')
        row.append(el('div', 'la-inv-item-main', item.main))
        if (item.detail) row.append(el('div', 'la-inv-item-detail', item.detail))
        if (item.subItems.length) {
          const ul = el('ul', 'la-inv-sublist')
          for (const s of item.subItems) ul.append(el('li', undefined, s))
          row.append(ul)
        }
        list.append(row)
      }
      box.append(list)
    } else if ((tag === 'titles' || tag === 'status') && entries.length > 1) {
      const chips = el('div', 'la-inv-chips')
      for (const entry of entries) chips.append(el('span', 'la-inv-chip', entry))
      box.append(chips)
    } else {
      box.append(el('div', 'la-flat-text', val))
    }
    container.append(box)
  }
  return matched
}

/* ── 15. Story Notes (flat) ── */
function renderStoryNotes(root: Element, container: HTMLElement): boolean {
  const fields: Array<[string, string]> = [
    ['threads', 'THREADS'],
    ['seeds', 'SEEDS'],
    ['motives', 'MOTIVES'],
    ['horizon', 'HORIZON'],
    ['GremlinNote', 'GREMLIN NOTE'],
    ['heckle', 'WORLD TURN'],
  ]
  let matched = false
  for (const [tag, label] of fields) {
    const val = childText(root, tag)
    if (!val || isEmptyVal(val)) continue
    matched = true
    const box = el('div', 'la-flat-panel')
    box.append(el('div', 'la-flat-badge', label), el('div', 'la-flat-text', val))
    container.append(box)
  }
  return matched
}

/* ── 16. Notebook (flat full-text cards with orange pencil icon) ── */
function renderNotebook(root: Element, container: HTMLElement): boolean {
  const entries = [...childrenByTag(root, 'ent'), ...childrenByTag(root, 'note')]
  if (!entries.length) return false
  for (const entry of entries) {
    const text = normText(entry.textContent)
    if (!text) continue
    const row = el('div', 'la-nb-row')
    row.append(el('span', 'la-nb-icon', '✏️'), el('div', 'la-flat-text', text))
    container.append(row)
  }
  return true
}

/* ── 17. Vent (flat) ── */
function renderVent(root: Element, container: HTMLElement): boolean {
  const vents = childrenByTag(root, 'vent')
  const texts = vents.length
    ? vents.map((v) => normText(v.textContent)).filter((t) => !isEmptyVal(t))
    : [normText(root.textContent)].filter((t) => !isEmptyVal(t))
  if (!texts.length) {
    renderEmpty(container, 'vent')
    return true
  }
  for (const t of texts) {
    const box = el('div', 'la-flat-panel')
    box.append(el('div', 'la-flat-text', t))
    container.append(box)
  }
  return true
}

/* ── Generic fallback renderer (safe text, never truncates) ── */
function renderGeneric(
  root: Element,
  container: HTMLElement,
  sectionId: string,
  sectionColor: string,
  collapsible: boolean,
  expandedCards: Set<string>,
  onToggle: () => void,
): void {
  const children = Array.from(root.children)
  if (!children.length) {
    const text = normText(root.textContent)
    if (!text || isEmptyVal(text)) {
      renderEmpty(container, sectionId)
      return
    }
    const box = el('div', 'la-flat-panel')
    box.append(el('div', 'la-flat-text', text))
    container.append(box)
    return
  }

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const subChildren = Array.from(child.children)
    const nameEl = subChildren.find((c) => ['name', 'names', 'pair', 'title'].includes(c.tagName.toLowerCase()))
    const badgeEl = subChildren.find((c) => ['standing', 'mode', 'status', 'salience'].includes(c.tagName.toLowerCase()))
    const title = nameEl ? normText(nameEl.textContent) : child.tagName.replace(/_/g, ' ')
    const badge = badgeEl ? normText(badgeEl.textContent) : undefined

    const buildBody = (body: HTMLElement) => {
      if (!subChildren.length) {
        const t = normText(child.textContent)
        if (t) body.append(el('div', 'la-flat-text', t))
        return
      }
      for (const sc of subChildren) {
        if (sc === nameEl) continue
        const val = normText(sc.textContent)
        if (!val) continue
        const row = el('div', 'la-card-detail')
        row.append(
          el('div', 'la-card-detail-title', sc.tagName.replace(/_/g, ' ').toUpperCase()),
          el('div', 'la-card-detail-text', val),
        )
        body.append(row)
      }
    }

    if (collapsible) {
      container.append(
        makeCollapsibleCard(
          {
            cardId: `${sectionId}:${title}:${i}`,
            icon: '•',
            title,
            badge,
            accentColor: sectionColor,
            expandedCards,
            onToggle,
          },
          buildBody,
        ),
      )
    } else {
      const box = el('div', 'la-flat-panel')
      if (subChildren.length) {
        box.append(el('div', 'la-flat-badge', title.toUpperCase()))
        buildBody(box)
      } else {
        box.append(el('div', 'la-flat-badge', child.tagName.replace(/_/g, ' ').toUpperCase()))
        box.append(el('div', 'la-flat-text', normText(child.textContent)))
      }
      container.append(box)
    }
  }
}

/* ── Main entrypoint ── */
export function renderStateSection(opts: {
  sectionId: string
  sectionLabel: string
  sectionColor: string
  collapsible: boolean
  raw: string
  container: HTMLElement
  expandedCards: Set<string>
  onToggle: () => void
}): void {
  const { sectionId, sectionLabel, sectionColor, collapsible, raw, container, expandedCards, onToggle } = opts
  const { root, blocked } = parseSectionXml(raw)
  if (blocked) {
    renderEmpty(container, sectionLabel)
    return
  }
  if (!root) {
    const fallback = normText(raw)
    if (!fallback || isEmptyVal(fallback)) {
      renderEmpty(container, sectionLabel)
      return
    }
    const box = el('div', 'la-flat-panel')
    box.append(el('div', 'la-flat-text', fallback))
    container.append(box)
    return
  }

  let handled = false
  switch (sectionId) {
    case 'world':
      handled = renderWorld(root, container)
      break
    case 'onscreen':
      handled = renderOnScreen(root, container, expandedCards, onToggle)
      break
    case 'offscreen_agendas':
      handled = renderOffScreen(root, container, expandedCards, onToggle)
      break
    case 'locations':
      handled = renderLocations(root, container, expandedCards, onToggle)
      break
    case 'entityMem':
      handled = renderEntityMemory(root, container, expandedCards, onToggle)
      break
    case 'entity_state':
      handled = renderEntityProfile(root, container, expandedCards, onToggle)
      break
    case 'thoughts':
      handled = renderThoughts(root, container, expandedCards, onToggle)
      break
    case 'dam':
      handled = renderDams(root, container, expandedCards, onToggle)
      break
    case 'pair':
      handled = renderPairs(root, container, expandedCards, onToggle)
      break
    case 'tracks':
      handled = renderTracks(root, container)
      break
    case 'arc':
      handled = renderArc(root, container)
      break
    case 'chekhov':
      handled = renderChekhov(root, container)
      break
    case 'leads':
      handled = renderLeads(root, container)
      break
    case 'inv':
      handled = renderInventory(root, container)
      break
    case 'story_notes':
      handled = renderStoryNotes(root, container)
      break
    case 'notebook':
      handled = renderNotebook(root, container)
      break
    case 'vent':
      handled = renderVent(root, container)
      break
  }

  if (!handled) {
    renderGeneric(root, container, sectionId, sectionColor, collapsible, expandedCards, onToggle)
  }
}
