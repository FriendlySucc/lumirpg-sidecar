import { expect, test } from 'bun:test'
import { buildUnifiedPrompt, extractUnifiedDelta } from '../src/unified-prompt.js'
import { emptyAtlasState } from '../src/geometry.js'

test('one analyzer prompt describes state and maps as a combined incremental update', () => {
  const state = { sections: { world: '<state:world><time>noon</time></state:world>' } }
  const prompt = buildUnifiedPrompt([{role:'user',content:'Hello'},{role:'assistant',content:'Hi'}], emptyAtlasState('c1'), state)
  expect(prompt).toContain('<state:world><time>noon</time></state:world>')
  expect(prompt).toContain('Hello')
  expect(prompt).toContain('statePatch')
  expect(prompt).toContain('mapPatch')
  expect(prompt).toContain('reputation')
  expect(prompt).toContain('DO NOT remove')
})

test('missing or malformed unified update is rejected and empty patches are accepted', () => {
  expect(extractUnifiedDelta('```json\n{"statePatch":{},"mapPatch":{}}\n```')).toEqual({statePatch:{},mapPatch:{}})
  expect(() => extractUnifiedDelta('{"surprise":true}')).toThrow()
  expect(() => extractUnifiedDelta('{"statePatch":null,"mapPatch":[]}')).toThrow()
})
