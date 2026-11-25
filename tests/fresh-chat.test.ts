import { beforeAll, expect, test } from 'bun:test'

import { decodeStoredState } from '../src/state-storage.js'

type Obj = Record<string, any>
const events = new Map<string, Array<(payload: any, userId?: string) => any>>()
const writes = new Map<string, any>()
const requests: any[] = []
const user = 'fresh-user'
const chat = 'fresh-chat'
let frontend: ((payload: unknown, userId: string, sessionId?: string) => Promise<void>) | undefined
const messages: any[] = [
  { id:'u1', role:'user', content:'I arrive in a new city.', swipe_id:0, hidden:false },
  { id:'a1', role:'assistant', swipe_id:0, hidden:false, content:'The city gates loom ahead. No state block here at all.' },
]
const mock: Obj = {
  host:{capabilities:{}},
  permissions:{has:()=>true,onChanged:()=>()=>{}},
  userStorage:{
    getJson:async(path:string, options:Obj)=>writes.has(path) ? structuredClone(writes.get(path)) : options.fallback,
    setJson:async(path:string, value:unknown)=>{ writes.set(path,structuredClone(value)) },
  },
  connections:{list:async()=>[{id:'sidecar',name:'Background',model:'m',provider:'custom'}]},
  chats:{getActive:async()=>({id:chat}),get:async(id:string, uid:string)=>id===chat&&uid===user?{id:chat}:null},
  chat:{getMessages:async()=>structuredClone(messages)},
  generate:{rawStream:async function* (request:Obj){
    requests.push(request)
    yield {type:'done',content:JSON.stringify({statePatch:{world:{fields:{loc:'City Gates'}}},mapPatch:{}}),finish_reason:'stop'}
  }},
  on:(name:string, fn:any)=>{ const a=events.get(name)??[]; a.push(fn); events.set(name,a); return ()=>{} },
  onFrontendMessage:(fn:any)=>{frontend=fn},
  registerInterceptor:()=>()=>{},
  sendToFrontend:()=>{},
  log:{info:()=>{},warn:()=>{},error:()=>{}},
}
function emit(name:string, payload:unknown){ for(const fn of events.get(name)??[]) fn(payload,user) }
async function waitUntil(predicate:()=>boolean){ for(let i=0;i<200;i++){if(predicate()) return; await Bun.sleep(5)} throw new Error('Timed out') }

beforeAll(async()=>{
  ;(globalThis as Obj).spindle=mock
  writes.set('lumi-atlas-v1/config.json',{connectionId:'sidecar',reasoningMode:'off'})
  await import(`../src/backend.js?fresh=${Date.now()}`)
})

test('a fresh chat without any legacy state bootstraps from a blank but shaped record', async()=>{
  await frontend!({type:'init',requestId:'1',chatId:chat},user)
  emit('GENERATION_STARTED',{chatId:chat,generationId:'g1',generationType:'normal'})
  emit('GENERATION_ENDED',{chatId:chat,generationId:'g1',generationType:'normal',messageId:'a1'})
  await waitUntil(()=>requests.length===1)
  const prompt = requests[0].messages.map((m:any)=>m.content).join('\n')
  expect(prompt).toContain('state:world')
  expect(prompt).toContain('state:offscreen_agendas')
  const key = 'lumi-atlas-v2/chats/fresh-chat.json'
  await waitUntil(()=>Boolean(writes.get(key)?.internalState))
  expect(writes.get(key).schema).toBe(2)
  const saved = decodeStoredState(writes.get(key).internalState)
  expect(saved.sections.world).toContain('<loc>City Gates</loc>')
  expect(Object.keys(saved.sections)).toHaveLength(18)
})
