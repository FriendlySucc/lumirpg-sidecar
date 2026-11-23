import { expect, test } from 'bun:test'
import { assessGeneration, sameSourceRevision } from '../src/generation-policy.js'

const start = { chatId: 'chat', generationId: 'g1', generationType: 'normal' }
test('only a matching successful saved assistant response is eligible', () => {
  expect(assessGeneration(start, { chatId:'chat', generationId:'g1', messageId:'m1' })).toEqual({ eligible:true, messageId:'m1' })
  expect(assessGeneration(start, { chatId:'chat', generationId:'g1', error:'failed', messageId:'m1' }).eligible).toBe(false)
  expect(assessGeneration(start, { chatId:'chat', generationId:'g1' }).eligible).toBe(false)
  expect(assessGeneration(start, { chatId:'chat', generationId:'g2', messageId:'m1' }).eligible).toBe(false)
  expect(assessGeneration({ ...start, backgroundSwipe:true }, {chatId:'chat',generationId:'g1',messageId:'m1'}).eligible).toBe(false)
  expect(assessGeneration({ ...start, generationType:'impersonate' }, {chatId:'chat',generationId:'g1',messageId:'m1'}).eligible).toBe(false)
  expect(assessGeneration({ ...start, generationType:'normal' }, {chatId:'chat',generationId:'g1',messageId:'m1',generationType:'impersonate'}).eligible).toBe(false)
  expect(assessGeneration({ ...start, generationType:'swipe' }, {chatId:'chat',generationId:'g1',messageId:'m1'}).eligible).toBe(false)
  expect(assessGeneration({ ...start, generationType:'regenerate' }, {chatId:'chat',generationId:'g1',messageId:'m1'}).eligible).toBe(false)
  expect(assessGeneration({ ...start, generationType:'continue' }, {chatId:'chat',generationId:'g1',messageId:'m1'}).eligible).toBe(false)
})

test('source revision includes active swipe and exact content, not just message id', () => {
  const source={id:'m1', role:'assistant', swipe_id:0, content:'original'}
  expect(sameSourceRevision(source, {...source})).toBe(true)
  expect(sameSourceRevision(source, {...source, swipe_id:1})).toBe(false)
  expect(sameSourceRevision(source, {...source, content:'edited'})).toBe(false)
  expect(sameSourceRevision(source, {...source, role:'user'})).toBe(false)
})
