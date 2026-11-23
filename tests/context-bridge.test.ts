import { describe, expect, test } from 'bun:test'
import { prepareSimulationContext } from '../src/context-bridge.js'

describe('canonical state hand-off to RP', () => {
  test('does not compact or inject into unrelated RP prompts', () => {
    const messages = [{role:'user' as const, content:'Continue the story.'}]
    expect(prepareSimulationContext(messages, {sections:{world:'<state:world><loc>Market</loc></state:world>'}})).toBe(messages)
  })

  test('unsupported prompts pass through unchanged instead of misleadingly claiming offload', () => {
    const messages = [{role:'user' as const, content:'Continue the story.'}]
    expect(prepareSimulationContext(messages, {sections:{
      world:'<state:world><loc>Market</loc></state:world>',
      offscreen_agendas:'<state:offscreen_agendas><ent_off><name>Casey</name><loc>Harbor</loc><agenda>Working</agenda></ent_off></state:offscreen_agendas>',
    }})).toBe(messages)
  })
})
