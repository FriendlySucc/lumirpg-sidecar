import { beforeAll, expect, test } from 'bun:test'

type Obj = Record<string, any>
const events = new Map<string, Array<(payload: any, userId?: string) => any>>()
const outbound: any[] = []
const writes = new Map<string, any>()
const requests: any[] = []
const user = 'test-user'
const chat = 'test-chat'
let frontend: ((payload: unknown, userId: string, sessionId?: string) => Promise<void>) | undefined
let interceptor: ((messages: any[], context: any) => Promise<any>) | undefined
let messages: any[] = [
  { id:'u1', role:'user', content:'I enter the shop.', swipe_id:0, hidden:false },
  { id:'a1', role:'assistant', swipe_id:0, hidden:false, content:'A clerk waves. <internal_states><state:world><time>morning</time><loc>Shop</loc></state:world><state:inv><inv>tools</inv></state:inv></internal_states>' },
]
let release: (() => void) | undefined
let waitForRelease = false
let nextMapPatch: Record<string, unknown> = {}
const configKey = 'lumi-atlas-v1/config.json'
const chatKey = 'lumi-atlas-v1/chats/test-chat.json'
const mock: Obj = {
  host:{capabilities:{}},
  permissions:{has:()=>true,onChanged:()=>()=>{}},
  userStorage:{
    getJson:async(path:string, options:Obj)=>writes.has(path) ? structuredClone(writes.get(path)) : options.fallback,
    setJson:async(path:string, value:unknown)=>{ writes.set(path,structuredClone(value)) },
  },
  connections:{list:async()=>[{id:'sidecar',name:'Background',model:'sidecar-model',provider:'custom'}]},
  chats:{getActive:async()=>({id:chat}),get:async(id:string, uid:string)=>id===chat&&uid===user?{id:chat}:null},
  chat:{getMessages:async()=>structuredClone(messages)},
  generate:{rawStream:async function* (request:Obj){
    requests.push(request)
    if(waitForRelease) await new Promise<void>(resolve=>{release=resolve})
    yield {type:'done',content:JSON.stringify({statePatch:{world:{fields:{time:'noon'}}},mapPatch:nextMapPatch}),finish_reason:'stop'}
  }},
  on:(name:string, fn:any)=>{ const a=events.get(name)??[]; a.push(fn); events.set(name,a); return ()=>{} },
  onFrontendMessage:(fn:any)=>{frontend=fn},
  registerInterceptor:(fn:any)=>{interceptor=fn;return()=>{}},
  sendToFrontend:(payload:any)=>{outbound.push(payload)},
  log:{info:()=>{},warn:()=>{},error:()=>{}},
}
function emit(name:string, payload:unknown){ for(const fn of events.get(name)??[]) fn(payload,user) }
async function waitUntil(predicate:()=>boolean){ for(let i=0;i<200;i++){if(predicate()) return; await Bun.sleep(5)} throw new Error('Timed out waiting for simulation result: '+JSON.stringify(outbound.slice(-3))) }

beforeAll(async()=>{
  ;(globalThis as Obj).spindle=mock
  writes.set(configKey,{connectionId:'sidecar',reasoningMode:'off'})
  await import('../src/backend.js')
})

test('enabling the extension runs one sidecar call on a successful new assistant reply and preserves the seed', async()=>{
  expect(frontend).toBeDefined()
  await frontend!({type:'init',requestId:'1',chatId:chat},user)
  const init = outbound.find(x=>x.type==='init')
  expect(init.config.enabled).toBe(true)
  expect(interceptor).toBeDefined()
  emit('GENERATION_STARTED',{chatId:chat,generationId:'g1',generationType:'normal'})
  emit('GENERATION_ENDED',{chatId:chat,generationId:'g1',generationType:'normal',messageId:'a1'})
  await waitUntil(()=>outbound.some(x=>x.type==='status'&&x.status==='ready'&&x.internalState))
  expect(requests).toHaveLength(1)
  expect(requests[0].userId).toBe(user)
  expect(requests[0].connection_id).toBe('sidecar')
  expect(requests[0].messages.map((m:any)=>m.content).join('\n')).toContain('statePatch')
  const saved=writes.get(chatKey)
  expect(saved.internalState.sections.world).toContain('<time>noon</time>')
  expect(saved.internalState.sections.inv).toContain('<inv>tools</inv>')
  const interception = await interceptor!([{role:'user',content:'Please continue.'}],{userId:user,chatId:chat})
  const prepared = Array.isArray(interception) ? interception : interception.messages
  expect(JSON.stringify(prepared)).toContain('Please continue.')
  expect(messages[1].content).toContain('<time>morning</time>')
})

test('pausing a chat stops both automatic simulation and prompt interception', async()=>{
  await frontend!({type:'set_chat_config',chatId:chat,enabled:false},user)
  const prompt = [{role:'user',content:'Please continue.'}]
  const interception = await interceptor!(prompt,{userId:user,chatId:chat})
  expect(interception).toBe(prompt)
  emit('GENERATION_STARTED',{chatId:chat,generationId:'g-disabled',generationType:'normal'})
  emit('GENERATION_ENDED',{chatId:chat,generationId:'g-disabled',generationType:'normal',messageId:'a1'})
  await Bun.sleep(30)
  expect(requests).toHaveLength(1)
  await frontend!({type:'set_chat_config',chatId:chat,enabled:true},user)
})

test('a changed or deleted source during the model call cannot overwrite the saved simulation', async()=>{
  const saved=structuredClone(writes.get(chatKey))
  messages.push({id:'u2',role:'user',content:'I leave.',swipe_id:0,hidden:false},{id:'a2',role:'assistant',content:'You leave.',swipe_id:0,hidden:false})
  waitForRelease=true
  emit('GENERATION_STARTED',{chatId:chat,generationId:'g2',generationType:'normal'})
  emit('GENERATION_ENDED',{chatId:chat,generationId:'g2',generationType:'normal',messageId:'a2'})
  await waitUntil(()=>Boolean(release))
  messages[messages.length-1].content='This reply was edited.'
  waitForRelease=false
  release!()
  await waitUntil(()=>outbound.some(x=>x.type==='status'&&x.status==='stale'))
  expect(writes.get(chatKey).internalState).toEqual(saved.internalState)
})

test('manual rebuild starts from a clean map instead of stacking onto old tiles', async()=>{
  waitForRelease = false
  messages[0].name = 'Kris Lyons'
  // First rebuild seeds a stale tile into the cached chat record
  nextMapPatch = {
    local: {
      id: 'old_zone',
      name: 'Old Zone',
      tiles: [{ id: 'stale_tile', name: 'Stale Tile', x: 0, y: 0, w: 10, h: 10, status: 'current' }],
    },
  }
  let beforeCount = requests.length
  await frontend!({type:'analyze',chatId:chat,mode:'rebuild'},user)
  await waitUntil(()=>requests.length > beforeCount)
  await waitUntil(()=>writes.get(chatKey).state.maps.local.tiles.some((t:any)=>t.id==='stale_tile'))

  // Second rebuild with an empty mapPatch must start clean (no stale_tile in prompt or result)
  nextMapPatch = {}
  beforeCount = requests.length
  await frontend!({type:'analyze',chatId:chat,mode:'rebuild'},user)
  await waitUntil(()=>requests.length > beforeCount)
  const rebuildPrompt = requests[requests.length - 1].messages.map((m:any)=>m.content).join('\n')
  expect(rebuildPrompt).not.toContain('stale_tile')
  expect(rebuildPrompt).toContain('Player character name: "Kris Lyons"')
  await waitUntil(()=>writes.get(chatKey).state.maps.local.tiles.length === 0)
  expect(writes.get(chatKey).state.maps.local.tiles).toHaveLength(0)
})

test('MESSAGE_EDITED on a newer reply or metadata-only update does not falsely mark chat stale', async()=>{
  waitForRelease = false
  nextMapPatch = {}
  const beforeCount = requests.length
  messages.push(
    { id:'u3', role:'user', name:'Kris Lyons', content:'I walk down Guild Row.', swipe_id:0, hidden:false },
    { id:'a3', role:'assistant', content:'The lanterns flicker along Guild Row.', swipe_id:0, hidden:false },
  )
  emit('GENERATION_STARTED', { chatId:chat, generationId:'g3', generationType:'normal' })
  // Host emits MESSAGE_EDITED while finalizing the brand-new assistant reply and saving token metadata
  emit('MESSAGE_EDITED', { chatId:chat, message:{ id:'a3' } })
  emit('MESSAGE_EDITED', { chatId:chat, message:{ id:'a2' } })
  emit('GENERATION_ENDED', { chatId:chat, generationId:'g3', generationType:'normal', messageId:'a3' })
  await waitUntil(()=>requests.length > beforeCount)
  await waitUntil(()=>writes.get(chatKey).state.analyzedMessageId === 'a3')
  expect(writes.get(chatKey).state.stale).toBe(false)

  // Genuine edit to the analyzed message content DOES mark stale
  messages[messages.length - 1].content = 'Manually edited assistant reply.'
  emit('MESSAGE_EDITED', { chatId:chat, message:{ id:'a3' } })
  await waitUntil(()=>writes.get(chatKey).state.stale === true)
  expect(writes.get(chatKey).state.stale).toBe(true)
})
