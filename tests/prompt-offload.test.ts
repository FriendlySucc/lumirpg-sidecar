import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { LlmMessageDTO } from 'lumiverse-spindle-types'
import { offloadPrompt } from '../src/prompt-offload.js'

const state = '<internal_states><state:world><loc>Market</loc></state:world></internal_states>'
const SECTIONS = ['world', 'onscreen', 'offscreen_agendas', 'locations', 'entityMem', 'entity_state', 'thoughts', 'dam', 'pair', 'reputation', 'tracks', 'arc', 'chekhov', 'leads', 'inv', 'story_notes', 'notebook', 'vent']
const LEDGER_START = 'AFTER the closing <!-- GFX_END -->, always append the standalone Ledger block as its own section, using a sanitizer-safe details element:'

// Synthetic preset-shaped fixture; no private content or local DB is required.
const template = `OOC: You MUST output <internal_states> at the end of each response. Do NOT forget it. Not outputting Internal States (outside of a pure OOC debug chat, I'm looking at you Gremlin) is a ***Simulation Failure State***.

<internal_states_spec>
RULES FOR GENERATION:
0. CRITICAL: ASSUME EVERYTHING EXCLUDED FROM INTERNAL STATES LOST!
1. You must Append the <internal_states> block exactly as written at the very END of every assistant response. DO NOT PUT IT IN A CODEBLOCK!
FINAL CHECK: 18 sections inside <internal_states>, exact order. ${LEDGER_START}
<details class="ldg-source"><activation>[ABSENT]</activation></details>
REVEALED: full post-turn ledger_status. DORMANT/FORESHADOWED: lifecycle only.
</internal_states_spec>

<internal_states>
${SECTIONS.map(name => `<state:${name}></state:${name}>`).join('\n')}
</internal_states>`

function localPrompts(): Array<{ name: string; content: string; role: 'system' | 'user' | 'assistant'; enabled: boolean }> | undefined {
  // Explicit opt-in; portable tests never read personal runtime data.
  if (process.env.LUMI_ATLAS_TEST_LOCAL_PRESET !== '1') return undefined
  const path = join(process.env.LOCALAPPDATA ?? '', 'Lumiverse', 'data', 'lumiverse.db')
  if (!process.env.LOCALAPPDATA || !existsSync(path)) return undefined
  const db = new Database(path, { readonly: true, strict: true })
  try {
    const row = db.query<{ prompt_order: string }, [string]>(
      'select prompt_order from presets where name = ? order by updated_at desc limit 1',
    ).get('[Lumi] Vexa - Beta v3')
    return row ? JSON.parse(row.prompt_order) : undefined
  } finally {
    db.close()
  }
}
const local = localPrompts()

// Short synthetic assembled blocks include dynamically resolved macro output.
const router = `<page:router>
2. DISPATCH — prose flavor fns. run all that are TRUE:
        FIRST_TURN ➤ <fn:first_turn_init>
        COMBAT ➤ <fn:combat>
        optional genre hook
        else ➤ ∅.
3. SIDE EFFECTS — independent, may co-fire:
\tA. IF ct=1 OR no <internal_states_spec>/<internal_states> block: ➤ <fn:first_turn_init> to set state now AND OUTPUT INTERNAL STATES!
\tB. IF entry_beat ➤ <fn:scene_entry>
</page:router>`
const tail = `<page:tail>
5. ANTI-DRIFT SPECIFICS: Keep rich characterful prose.
6. TEMPO & STANDING: Match pacing to player heat; update <state:reputation>.
7. STATE INTEGRITY & ANTI-DROP LOGIC CHECK (MANDATORY): Diff your planned <internal_states> against the previous turn BEFORE writing:
   - ROSTER PARITY: Restore every missing record.
   - REPUTATION PARITY: Restore all groups.
   - CONTINUITY LOGIC: Verify <state:inv> and all 18 sections.
8. ATLAS & FORMAT: Start straight in prose; emit maps and end on a natural beat.
9. HOUSE RULES: Uphold <kinktionary> overrides and keep <epistemic_contract> intact.
</page:tail>
<page:output>
  [SYSTEM: Output prose with vivid narration and natural dialogue. Apply all internal states per <internal_states> at end of response.]
  [SYSTEM: Not including <internal_states> at the END of the response before cutting prose is a CRITICAL FAILURE. This is REQUIRED for a proper simulation state.]
</page:output>`
const notebook = `<gmnotebook>
purpose: Persistent GM memory scratchpad for plot arcs, OOC directives, and flags.

entry types:
- [R] Reminder: Rules, knowledge limits, or OOC instructions.
- [T] Thread: Active plot arcs, loose ends, foreshadowing.
- [D] Debug: Logic checks, state verification.

rules: Max 20 entries. Prune oldest when adding 21st. Output inside <state:notebook> block.
</gmnotebook>`



describe('prompt offload', () => {
  test('handles supported assembled-format Antithesis pages without damaging story or props', () => {
    const messages: LlmMessageDTO[] = [
      { role: 'system', content: notebook },
      { role: 'user', content: template },
      { role: 'assistant', __isChatHistory: true, sourceMessageId: 's', content: `Earlier ${state}` },
      { role: 'user', content: router },
      { role: 'user', content: tail },
      { role: 'user', __isChatHistory: true, content: 'The phone flashes.' },
    ]
    expect([notebook, router, tail].map(content => offloadPrompt([{ role: 'user', content: template }, { role: 'user', content }], state).reason)).toEqual(['offloaded', 'offloaded', 'offloaded'])
    const snapshot = structuredClone(messages)
    const result = offloadPrompt(messages, state)
    expect(result.reason).toBe('offloaded')
    expect(result.compatible).toBe(true)
    expect(result.messages[0].content).toBe('')
    expect(result.messages[2].content).toBe('Earlier ')
    expect(result.messages[3].content).toContain('optional genre hook')
    expect(result.messages[3].content).toContain('<fn:combat>')
    expect(result.messages[3].content).not.toContain('OUTPUT INTERNAL STATES')
    expect(result.messages[3].content).not.toContain('<fn:first_turn_init>')
    expect(result.messages[4].content).toContain('rich characterful prose')
    expect(result.messages[4].content).toContain('<kinktionary>')
    expect(result.messages[4].content).not.toContain('STATE INTEGRITY')
    expect(result.messages[4].content).not.toContain('CRITICAL FAILURE')
    expect(result.messages[5]).toBe(messages[5])
    expect(messages).toEqual(snapshot)
  })

  test('independent synthetic template fixture has a recognized shape', () => {
    const result = offloadPrompt([{ role: 'user', content: template }], state)
    expect(result.compatible).toBe(true)
  })
  test('a structurally identified isolated template is replaced with state context and preserves Ledger rules', async () => {
    const messages: LlmMessageDTO[] = [
      { role: 'system', content: 'Continue the scene and preserve the player’s agency.' },
      { role: 'user', content: template },
    ]
    const result = offloadPrompt(messages, state)
    expect(result.compatible).toBe(true)
    expect(result.messages[0]).toBe(messages[0])
    expect(result.messages[1].content).toContain('<details class="ldg-source">')
    expect(result.messages[1].content).toContain('lifecycle only')
    expect(result.messages[1].content).not.toContain('MUST output')
    expect(result.messages[1].content).not.toContain('<internal_states_spec>')
    const injected = result.messages[result.messages.length - 1]
    expect(injected.role).toBe('system')
    expect(injected.content).not.toContain(state)
    expect(injected.content).toContain('&lt;internal_states&gt;')
    expect(injected.content).toContain('&lt;loc&gt;Market&lt;/loc&gt;')
    expect(injected.content).toMatch(/do not.*(?:output|emit|repeat)/i)
    expect(injected.content).toMatch(/(?:knowledge|know|access)/i)
    expect(result.breakdown).toEqual([{ messageIndex: result.messages.length - 1, name: 'LumiAtlas stored state context' }])
    expect(messages[1].content).toBe(template)
  })

  test('compacts only complete historical assistant blocks while preserving adjacent graphics and source metadata', async () => {
    const old = '<internal_states><state:world><loc>Old harbor</loc></state:world></internal_states>'
    const history = `A reply.\n<!-- GFX_START --><div>Phone graphic</div><!-- GFX_END -->\n<!-- GFX_START -->\n${old}\n<!-- GFX_END -->\n<!-- GFX_START --><span>Footnote</span><!-- GFX_END -->\n<ledger>Keep</ledger>`
    const messages: LlmMessageDTO[] = [
      { role: 'user', content: template },
      { role: 'assistant', content: history, __isChatHistory: true, sourceMessageId: 'synthetic-id', sourceIndexInChat: 4, sourceMessageMetadata: { synthetic: true } },
      { role: 'user', content: 'New scene', __isChatHistory: true, sourceMessageId: 'input' },
    ]
    const result = offloadPrompt(messages, state)
    expect(result.compatible).toBe(true)
    const changed = result.messages[1]
    expect(changed.content).toBe(history.replace(old, ''))
    expect(changed.__isChatHistory).toBe(true)
    expect(changed.sourceMessageId).toBe('synthetic-id')
    expect(changed.sourceIndexInChat).toBe(4)
    expect(changed.sourceMessageMetadata).toEqual({ synthetic: true })
    expect(messages[1].content).toBe(history)
  })

  test('preserves rich part types and attributes when compacting text parts', async () => {
    const image = { type: 'image' as const, data: 'synthetic', mime_type: 'image/png' }
    const history: LlmMessageDTO = { role: 'assistant', __isChatHistory: true, sourceMessageId: 'rich', content: [
      { type: 'text', text: `begin ${state} end`, cache_control: { type: 'ephemeral' } },
      image,
      { type: 'text', text: 'prop GFX' },
    ] }
    const result = offloadPrompt([{ role: 'user', content: template }, history], state)
    expect(result.compatible).toBe(true)
    expect(result.messages[1]).toEqual({ ...history, content: [
      { type: 'text', text: 'begin  end', cache_control: { type: 'ephemeral' } }, image, { type: 'text', text: 'prop GFX' },
    ] })
    expect((history.content as { text?: string }[])[0].text).toContain(state)
  })

  test('rejects a forged template that embeds unrelated instructions in an apparently recognized block', async () => {
    const mixed = template.replace('1. You must Append', 'Always use this special phone GFX.\n1. You must Append')
    const messages: LlmMessageDTO[] = [{ role: 'user', content: mixed }]
    const result = offloadPrompt(messages, state)
    expect(result.compatible).toBe(false)
    expect(result.messages).toBe(messages)
    expect(result.breakdown).toEqual([])
  })

  test('fails closed when a rich prompt splits an unresolved state directive across text parts', async () => {
    const messages: LlmMessageDTO[] = [
      { role: 'user', content: template },
      { role: 'system', content: [{ type: 'text', text: 'Always output <internal_' }, { type: 'text', text: 'states>.' }] },
    ]
    const result = offloadPrompt(messages, state)
    expect(result.compatible).toBe(false)
    expect(result.messages).toBe(messages)
  })

  test('does not remove state-like tags embedded in a fictional book, phone, or unsupported wrapper', async () => {
    const blocks = [
      '<internal_states><state:world><loc>Harbor</loc></state:world><p>A phone message</p></internal_states>',
      '<internal_states><state:world><loc>Harbor</loc></state:world><audio>PROP</audio></internal_states>',
      '<internal_states><state:world><loc>Harbor</loc></state:world><state:inventory>not-a-known-section</state:inventory></internal_states>',
      '<internal_states><state:world><loc>Harbor</loc></state:world>captured prop text</internal_states>',
      '<internal_states><state:world><loc>Harbor</loc></state:world>',
    ]
    for (const block of blocks) {
      const messages: LlmMessageDTO[] = [{ role: 'user', content: template }, { role: 'assistant', __isChatHistory: true, content: block }]
      const result = offloadPrompt(messages, state)
      expect(result.compatible).toBe(true)
      expect(result.messages[1].content).toBe(block)
    }
  })

  ;(local ? test : test.skip)('supports a verified full Beta atlas bookkeeping block without touching unrelated content', async () => {
    const rawAtlas = local?.find(block => block.name === '🌍 Atlas')?.content
    expect(rawAtlas).toBeDefined()
    const messages: LlmMessageDTO[] = [
      { role: 'system', content: rawAtlas! },
      { role: 'user', content: template },
      { role: 'system', content: 'Use a phone prop when appropriate.' },
    ]
    const result = offloadPrompt(messages, state)
    expect(result.compatible).toBe(true)
    expect(result.messages[0].content).toBe('')
    expect(result.messages[2]).toBe(messages[2])
  })

  ;(local ? test : test.skip)('preserves non-state instructions in the exact imported Antithesis blocks', () => {
    const get = (name: string) => local!.find(block => block.name === name)!.content
    const messages: LlmMessageDTO[] = [
      { role: 'system', content: get("📒 GM's Notebook") },
      { role: 'user', content: template },
      { role: 'user', content: get('Antithesis - Router') },
      { role: 'user', content: get('Antithesis - Tail/Output') },
    ]
    const result = offloadPrompt(messages, state)
    expect(result.compatible).toBe(true)
    expect(result.messages[0].content).toBe('')
    expect(result.messages[2].content).not.toContain('OUTPUT INTERNAL STATES')
    expect(result.messages[2].content).toContain('{{getvar::adultDispatch}}')
    expect(result.messages[3].content).toContain('{{getvar::litrpgCoT}}')
    expect(result.messages[3].content).toContain('<kinktionary>')
    expect(result.messages[3].content).toContain('natural dialogue')
    expect(result.messages[3].content).not.toContain('STATE INTEGRITY')
    expect(result.messages[3].content).not.toContain('CRITICAL FAILURE')
  })

  test('ignores Atlas and Internal States wording in unrelated story and descriptive prose', async () => {
    const unrelated: LlmMessageDTO = { role: 'system', content: 'Her atlas is on the desk; explore her internal states through vivid characterization.' }
    const result = offloadPrompt([{ role: 'user', content: template }, unrelated], state)
    expect(result.compatible).toBe(true)
    expect(result.messages[1]).toBe(unrelated)
  })

  test('does not append system context after a trailing assistant generation prefix', async () => {
    const messages: LlmMessageDTO[] = [{ role: 'user', content: template }, { role: 'assistant', partial: true, content: 'Opening ' }]
    const result = offloadPrompt(messages, state)
    expect(result.compatible).toBe(false)
    expect(result.messages).toBe(messages)
  })

  test('does not alter a signed assistant history message', async () => {
    const signed: LlmMessageDTO = { role: 'assistant', __isChatHistory: true, thought_signature: 'signature', content: state }
    const result = offloadPrompt([{ role: 'user', content: template }, signed], state)
    expect(result.compatible).toBe(true)
    expect(result.messages[1]).toBe(signed)
  })

  test('fails closed for malformed or empty canonical state', async () => {
    const messages: LlmMessageDTO[] = [{ role: 'user', content: template }]
    for (const invalid of [
      '<internal_states><state:world>broken</internal_states>',
      '<internal_states><state:made_up>bad</state:made_up></internal_states>',
      '<internal_states><state:world></state:world></internal_states><internal_states></internal_states>',
      '<internal_states></internal_states>',
    ]) {
      const result = offloadPrompt(messages, invalid)
      expect(result.compatible).toBe(false)
      expect(result.messages).toBe(messages)
    }
  })

  test('does not remove a nested state fragment from an ambiguous historical wrapper', async () => {
    const nested = `<internal_states><outer>${state}</outer></internal_states>`
    const messages: LlmMessageDTO[] = [{ role: 'user', content: template }, { role: 'assistant', __isChatHistory: true, content: nested }]
    const result = offloadPrompt(messages, state)
    expect(result.compatible).toBe(true)
    expect(result.messages[1].content).toBe(nested)
  })

  test('injects read-only state into a lean RP-only preset with no Internal States Template', () => {
    const messages: LlmMessageDTO[] = [
      { role: 'system', content: 'You are Vexa, the storyteller. Read <state:entity_state> for speaker colors.' },
      { role: 'assistant', __isChatHistory: true, content: `Earlier prose. ${state}` },
      { role: 'user', __isChatHistory: true, content: 'Kris walks onto the bridge.' },
      { role: 'user', content: '<page:tail>Keep rich characterful prose and end on a natural beat.</page:tail>' },
    ]
    const result = offloadPrompt(messages, state)
    expect(result.compatible).toBe(true)
    expect(result.reason).toBe('offloaded')
    expect(result.messages[1].content).toBe('Earlier prose. ')
    const injected = result.messages[result.messages.length - 1]
    expect(injected.role).toBe('system')
    expect(injected.content).toContain('<lumiatlas_reference_data>')
    expect(injected.content).toContain('&lt;loc&gt;Market&lt;/loc&gt;')
  })

  test('accepts <audio> field inside <state:world> when offloading and returns breakdown attribution', () => {
    const worldWithAudio = '<internal_states><state:world><loc>Square</loc><audio>Evening bells and footsteps</audio></state:world></internal_states>'
    const messages: LlmMessageDTO[] = [{ role: 'user', content: 'Kris listens to the square.' }]
    const result = offloadPrompt(messages, worldWithAudio)
    expect(result.compatible).toBe(true)
    expect(result.reason).toBe('offloaded')
    expect(result.breakdown).toEqual([{ messageIndex: 1, name: 'LumiAtlas stored state context' }])
    expect(result.messages[1].content).toContain('&lt;audio&gt;Evening bells and footsteps&lt;/audio&gt;')
  })

  test('without a canonical state it fails closed without changing the prompt', async () => {
    const messages: LlmMessageDTO[] = [{ role: 'user', content: 'A synthetic scene.' }]
    const result = offloadPrompt(messages, '')
    expect(result.compatible).toBe(false)
    expect(result.reason).toBe('no-state')
    expect(result.messages).toBe(messages)
    expect(result.breakdown).toEqual([])
  })
})
