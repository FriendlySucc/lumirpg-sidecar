import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { Window } from 'happy-dom'
import { renderStateSection } from '../src/state-renderer.js'

describe('native Vexa GFX state renderers', () => {
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

  function render(sectionId: string, raw: string, expanded: string[] = []): HTMLElement {
    const container = win.document.createElement('div') as unknown as HTMLElement
    const expandedCards = new Set<string>(expanded)
    renderStateSection({
      sectionId,
      sectionLabel: sectionId,
      sectionColor: '#c4973c',
      collapsible: ['onscreen', 'offscreen_agendas', 'locations', 'entityMem', 'entity_state', 'thoughts', 'dam', 'pair', 'reputation'].includes(sectionId),
      raw,
      container,
      expandedCards,
      onToggle: () => {},
    })
    return container
  }

  test('Pairs renders bidirectional 6-axis bars from emoji matrix when expanded', () => {
    const raw = `<state:pair>
      <pair>
        <names>Jessie↔Kris⠀Lyons</names>
        <mode>mode:warm</mode>
        <dam>E:s⠀L:o⠀Gate:attentive</dam>
        <matrix>🌶️[3,0]⠀🎲[6,0]⠀🤝[11,0]⠀🛠️[10,0]⠀🏠[7,0]⠀🕊️[5,0]⠀😠[3,0]⠀🥊[4,0]⠀❄️[3,0]⠀🪨[4,0]⠀🌫️[3,0]⠀🐍[3,0]</matrix>
        <wall>wall:∅</wall>
      </pair>
    </state:pair>`

    const collapsed = render('pair', raw)
    expect(collapsed.textContent).toContain('Jessie↔Kris Lyons')
    expect(collapsed.textContent).toContain('warm')
    expect(collapsed.querySelectorAll('.la-axis-row').length).toBe(0)

    const expanded = render('pair', raw, ['pair:Jessie↔Kris Lyons'])
    expect(expanded.querySelectorAll('.la-axis-row').length).toBe(6)
    expect(expanded.textContent).toContain('E · s')
    expect(expanded.textContent).toContain('L · o')
    expect(expanded.textContent).toContain('Gate · attentive')
    expect(expanded.textContent).toContain('Friendship')
    expect(expanded.textContent).toContain('11')
    expect(expanded.textContent).toContain('Commitment')
    expect(expanded.textContent).toContain('10')
  })

  test('Dams renders Sluices, Flags, 4-option Filters, and Intent when expanded', () => {
    const raw = `<state:dam>
      <ent_dam>
        <pair>Stefania⠀Nowak→Kris⠀Lyons</pair>
        <sluice>E:sealed⠀L:open</sluice>
        <filters>Soc:c(1)(0)⠀Val:c(1)(0)⠀Comp:c(2)(0)⠀Rel:h(0)(0)</filters>
        <misc>clash:—⠀|⠀T:no</misc>
        <intent>intent:keep⠀a⠀sensible,⠀no-bullshit⠀repeat⠀customer</intent>
      </ent_dam>
    </state:dam>`

    const expanded = render('dam', raw, ['dam:Stefania Nowak→Kris Lyons'])
    expect(expanded.textContent).toContain('DIRECTIONAL')
    expect(expanded.textContent).toContain('SLUICES')
    expect(expanded.textContent).toContain('FLAGS')
    expect(expanded.textContent).toContain('SOCIAL')
    expect(expanded.textContent).toContain('(1)(0)')
    expect(expanded.textContent).toContain('keep a sensible, no-bullshit repeat customer')
    expect(expanded.querySelectorAll('.la-opt-amber').length).toBeGreaterThanOrEqual(4)
    expect(expanded.querySelectorAll('.la-opt-green').length).toBeGreaterThanOrEqual(1)
    expect(expanded.querySelectorAll('.la-opt-red').length).toBeGreaterThanOrEqual(1)
  })

  test('Thoughts renders Q1-Q5 BTS interview cards when expanded', () => {
    const raw = `<state:thoughts>
      <ent_think>
        <name>Roman⠀Carax</name>
        <tQ1>Get⠀back⠀to⠀Carax's⠀Cuts.</tQ1>
        <tQ2>Really⠀glad⠀I⠀got⠀Kris's⠀name.</tQ2>
        <tQ3>Timing⠀the⠀developer⠀bath.</tQ3>
        <tQ4>Good⠀people⠀are⠀hard⠀to⠀spot.</tQ4>
        <tQ5>See⠀you⠀tomorrow,⠀Kris.</tQ5>
      </ent_think>
    </state:thoughts>`

    const expanded = render('thoughts', raw, ['thoughts:Roman Carax'])
    expect(expanded.textContent).toContain('BTS INTERVIEW')
    expect(expanded.querySelectorAll('.la-qa-card').length).toBe(5)
    expect(expanded.textContent).toContain("What's your goal right now?")
    expect(expanded.textContent).toContain("Get back to Carax's Cuts.")
    expect(expanded.textContent).toContain('See you tomorrow, Kris.')
  })

  test('Inventory and Notebook render full untruncated text flat without chevrons', () => {
    const longInv = `<state:inv>
      <inv>41⠀eddies,⠀scratched⠀agent⠀(contacts:⠀Jessie,⠀Roman⠀Carax⠀#774-092-118),⠀canvas⠀tote⠀with⠀full⠀40W⠀reconditioned⠀Japanese⠀soldering⠀iron⠀and⠀micro-bit⠀cassette</inv>
      <titles>Rancho⠀Coronado⠀New⠀Tenant,⠀Kabuki⠀Scrounger</titles>
      <status>Rested⠀(10h⠀sleep),⠀hungry⠀for⠀midday⠀meal</status>
    </state:inv>`

    const invEl = render('inv', longInv)
    expect(invEl.querySelector('.la-card-head')).toBeNull()
    expect(invEl.textContent).toContain('ITEMS')
    expect(invEl.textContent).toContain('TRAITS')
    expect(invEl.textContent).toContain('STATUS')
    expect(invEl.textContent).toContain('micro-bit cassette')

    const nbRaw = `<state:notebook>
      <ent>[T]⠀12:18⠀PM⠀Nov⠀17:⠀Kris⠀introduced⠀themselves⠀to⠀Roman⠀Carax⠀and⠀swapped⠀comm⠀numbers⠀(#774-092-118)⠀before⠀he⠀headed⠀west⠀into⠀the⠀crowd.</ent>
    </state:notebook>`
    const nbEl = render('notebook', nbRaw)
    expect(nbEl.querySelector('.la-card-head')).toBeNull()
    expect(nbEl.querySelectorAll('.la-nb-row').length).toBe(1)
    expect(nbEl.textContent).toContain('headed west into the crowd.')
  })
})
