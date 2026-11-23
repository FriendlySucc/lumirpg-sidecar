import { describe, expect, test } from 'bun:test'
import { prepareSimulationContext } from '../src/context-bridge.js'

describe('canonical state hand-off to RP', () => {
  test('injects read-only canonical state into clean RP-only prompts without a template', () => {
    const messages = [{ role: 'user' as const, content: 'Continue the story.' }]
    const result = prepareSimulationContext(messages, {
      sections: {
        world: '<state:world><loc>Market</loc></state:world>',
        offscreen_agendas: '<state:offscreen_agendas><ent_off><name>Casey</name><loc>Harbor</loc><agenda>Working</agenda></ent_off></state:offscreen_agendas>',
      },
    })
    expect(result.length).toBe(2)
    expect(result[0]).toBe(messages[0])
    expect(result[1].role).toBe('system')
    expect(result[1].content).toContain('<lumiatlas_reference_data>')
    expect(result[1].content).toContain('&lt;loc&gt;Market&lt;/loc&gt;')
    expect(result[1].content).toContain('Casey')
  })

  test('fails closed when a prompt contains unresolved state-generation instructions', () => {
    const messages = [
      { role: 'system' as const, content: 'You must output <internal_states> at the end.' },
      { role: 'user' as const, content: 'Continue the story.' },
    ]
    expect(prepareSimulationContext(messages, { sections: { world: '<state:world><loc>Market</loc></state:world>' } })).toBe(messages)
  })
})
