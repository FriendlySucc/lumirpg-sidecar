import { expect, test } from 'bun:test'
import { emptyAtlasState } from '../src/geometry.js'

type Bag = Record<string, any>
const chat = 'triage-chat', uid = 'triage-user'
const configKey = 'lumi-atlas-v1/config.json'
const legacyKey = `lumi-atlas-v1/chats/${chat}.json`
const jsonKey = `lumi-atlas-v2/chats/${chat}.json`
const quiet = { statePatch: {}, mapPatch: {} }
let sequence = 0
function msg(id: string, role: 'user' | 'assistant' | 'system', content: string, hidden = false) {
  return { id, role, content, name: role === 'user' ? 'Kris Lyons' : 'Narrator', swipe_id: 0, hidden }
}
const old = [msg('u1','user','Old turn only: I take in the city.'), msg('a1','assistant','Old reply only: night falls.')]
function legacy() {
  return { schema: 1, config: {enabled:true, autoUpdate:true},
    state: {...emptyAtlasState(chat), updatedAt:'2026-01-01T00:00:00.000Z', analyzedMessageId:'a1', analyzedMessageCount:2},
    sourceRevision: {id:'a1',role:'assistant',swipe_id:0,content:old[1].content},
    archives: {local:[],region:[],world:[]}, internalState: {sections:{
      world:'<state:world><ct>28</ct><user_pos>By the column</user_pos><time>Dusk</time></state:world>',
      inv:'<state:inv><inv>Brass compass</inv></state:inv>'
    }} }
}
async function harness(rows: ReturnType<typeof msg>[], initial: Record<string, unknown> = {[legacyKey]:legacy()}) {
  const files = new Map<string, any>(Object.entries({...initial, [configKey]:{connectionId:'selected',reasoningMode:'inherit'}}))
  const requests: Bag[] = [], notices: Bag[] = [], bgReads: string[] = [], writes: string[] = []
  const handlers = new Map<string, Function>()
  let frontend!: Function
  let intercept!: Function
  const result: {next: unknown; during?:()=>void; finish?:string; unfinished?:boolean} = {next:quiet}
  ;(globalThis as Bag).spindle = {
    host:{capabilities:{'chat-lean-messages-v1':1}}, permissions:{has:()=>true,onChanged:()=>()=>{}},
    userStorage:{getJson:async(key:string,{fallback}:Bag)=>structuredClone(files.has(key)?files.get(key):fallback),setJson:async(key:string,v:unknown)=>{files.set(key,structuredClone(v));writes.push(key)}},
    connections:{list:async()=>[{id:'selected',name:'Chosen connection',model:'fixture-model',provider:'fixture'}]},
    chats:{get:async()=>({id:chat,character_id:'char'}),getActive:async()=>({id:chat})},
    chat:{getMessages:async(_id:string,opt?:Bag)=>structuredClone(opt?.tail ? rows.slice(-opt.tail) : rows)},
    characters:{get:async()=>{bgReads.push('card');return {name:'CardOnlyMarker',description:'Character card context'}}},
    personas:{getActive:async()=>{bgReads.push('persona');return {name:'Kris Lyons',description:'PersonaOnlyMarker'}}},
    world_books:{getActivated:async()=>{bgReads.push('lore');return [{id:'lore'}]},entries:{get:async()=>({content:'LoreOnlyMarker'})}},
    generate:{rawStream:async function* (r:Bag){requests.push(r);result.during?.();if(result.unfinished){yield {type:'token',token:JSON.stringify(result.next)};return}yield {type:'done',content:JSON.stringify(result.next),finish_reason:result.finish ?? 'stop'}}},
    on:(ev:string,fn:Function)=>{handlers.set(ev,fn);return ()=>{}},onFrontendMessage:(fn:Function)=>{frontend=fn},registerInterceptor:(fn:Function)=>{intercept=fn;return ()=>{}},sendToFrontend:(m:Bag)=>notices.push(m),log:{info:()=>{},warn:()=>{},error:()=>{}}
  }
  await import(`../src/backend.js?triage-workflow=${++sequence}`)
  const until = async (check:()=>boolean) => { for(let i=0;i<250;i++){if(check())return;await Bun.sleep(4)} throw new Error(`No terminal status: ${notices.at(-1)?.message}`) }
  async function run(mode:'update'|'rebuild'|'auto'='update') {
    const n = notices.length
    if(mode === 'auto') {
      const generationId = `g-${rows.at(-1)!.id}`
      const base = {chatId:chat,generationId,generationType:'normal'}
      handlers.get('GENERATION_STARTED')!(base, uid)
      handlers.get('GENERATION_ENDED')!({...base,messageId:rows.at(-1)!.id},uid)
    } else await frontend({type:'analyze',chatId:chat,mode},uid)
    await until(()=>notices.slice(n).some(x=>x.type==='status' && ['ready','error','stale'].includes(x.status)))
    return notices.at(-1)!
  }
  return {run,rows,result,requests,notices,bgReads,files,writes,until,event:(ev:string,payload:Bag)=>handlers.get(ev)!({chatId:chat,...payload},uid),init:async()=>{await frontend({type:'init',chatId:chat},uid);return notices.at(-1)!},rp:()=>intercept([{role:'user',content:'Next.'}],{userId:uid,chatId:chat})}
}

test('a settled chat analyzes just the newest exchange against JSON; sparse saves are not bootstrap requests', async()=>{
  const rows = [...old, msg('hidden','user','HiddenMarker',true), msg('u2','user','I cry and step back.'), msg('s','system','SystemMarker'),msg('a2','assistant','Kris stops by the bench.')]
  const h = await harness(rows)
  h.result.next = {statePatch:{world:{user_pos:'Beside the bench'}}, mapPatch:{}}
  const status = await h.run('auto')
  expect(h.bgReads).toEqual([])
  expect(h.requests).toHaveLength(1)
  const req = h.requests[0]
  const data = JSON.parse(req.messages[1].content)
  expect(data.turn.map((m:Bag)=>m.content)).toEqual(['I cry and step back.','Kris stops by the bench.'])
  expect(data.atlas.state.world.user_pos).toBe('By the column')
  expect(data.atlas.maps.world.tiles).toEqual([])
  expect(req.messages[0].content).not.toContain('INITIALIZATION')
  expect(req.reasoning).toEqual({source:'inherit'})
  expect(status.status).toBe('ready')
  expect(status.internalState.sections.world).toContain('<user_pos>Beside the bench</user_pos>')
  expect(status.internalState.sections.world).toContain('<ct>29</ct>')
  expect(status.internalState.sections.inv).toBe(legacy().internalState.sections.inv)
  expect(h.files.get(legacyKey)).toEqual(legacy())
  expect(h.files.get(jsonKey)?.schema).toBe(2)
})

test('an empty diff acknowledges the reply once, also after upgrading and restarting', async()=>{
  const rows = [...old,msg('u2','user','I wait.'),msg('a2','assistant','Nothing else changes.')]
  const h = await harness(rows)
  const done = await h.run()
  expect(done.status).toBe('ready')
  expect(done.internalState.sections.world).toContain('<ct>29</ct>')
  expect(done.state.analyzedMessageId).toBe('a2')
  expect(done.message).toMatch(/no story changes/i)
  const resumed = await harness(rows,Object.fromEntries(h.files))
  const initial = await resumed.init()
  expect(initial.internalState).toEqual(done.internalState)
  await resumed.run()
  expect(resumed.requests).toHaveLength(0)
  expect(resumed.writes).toHaveLength(0)
  expect(JSON.stringify(await resumed.rp())).toContain('Brass compass')
})

test('Rebuild includes older visible transcript and background; the next Analyze does not', async()=>{
  const rows = Array.from({length:18},(_,i)=>msg(`m${i}`,i%2?'assistant':'user',i===0?'OpeningMarker':`Repeated history ${i}`))
  const h = await harness(rows,{})
  const seeded = await h.run('rebuild')
  expect(seeded.status).toBe('ready')
  const text = h.requests[0].messages.map((x:Bag)=>x.content).join('\n')
  for (const marker of ['OpeningMarker','LoreOnlyMarker','PersonaOnlyMarker','CardOnlyMarker','INITIALIZATION PASS']) expect(text).toContain(marker)
  h.bgReads.length=0
  rows.push(msg('u3','user','We return three days later.'),msg('a3','assistant','The flooding has cut off the road. The courier made it to the port.'))
  h.result.next = {tier:'timeskip', statePatch:{world:{time:'Morning',weather:'Flooding'}, offscreen_agendas:{Courier:{loc:'Port',agenda:'Deliver the letter'}}}, mapPatch:{}}
  const later = await h.run()
  expect(h.requests).toHaveLength(2)
  expect(h.requests[1].parameters.max_tokens ?? Infinity).toBeGreaterThanOrEqual(h.requests[0].parameters.max_tokens ?? 8192)
  expect(h.bgReads).toEqual([])
  expect(h.requests[1].messages[1].content).not.toContain('OpeningMarker')
  expect(later.status).toBe('ready')
  expect(later.internalState.sections.offscreen_agendas).toContain('<loc>Port</loc>')
})

test('Analyze does not combine an old reply with a newer user, or silently skip a missed reply', async()=>{
  const h = await harness([...old,msg('u2','user','I leave.'),msg('a2','assistant','The gate closes.'),msg('u3','user','I return.'),msg('a3','assistant','It is summer.')])
  const stopped = await h.run()
  expect(stopped.status).toBe('stale')
  expect(h.requests).toHaveLength(0)
  expect(h.files.get(legacyKey)).toEqual(legacy())
})

test('a changed user action during Analyze cannot commit an otherwise unchanged reply', async()=>{
  const rows = [...old,msg('u2','user','I walk.'),msg('a2','assistant','You stop.')]
  const h = await harness(rows)
  h.result.during = ()=>{ rows[2].content='I do not walk.' }
  const ended = await h.run()
  expect(ended.status).toBe('stale')
  expect(ended.state.analyzedMessageId).toBe('a1')
  expect(ended.internalState.sections.world).toBe(legacy().internalState.sections.world)
})

test('quick consecutive generations process their own completed turn in order, never half the next reply', async()=>{
  const rows = [...old,msg('u2','user','At the market.'),msg('a2','assistant','The market closes.')]
  const h = await harness(rows)
  h.result.during = ()=>{
    delete h.result.during
    rows.push(msg('u3','user','We go home.'))
    h.event('GENERATION_STARTED',{generationId:'g-a3',generationType:'normal'})
    rows.push(msg('a3','assistant','The door opens.'))
    h.event('GENERATION_ENDED',{generationId:'g-a3',generationType:'normal',messageId:'a3'})
  }
  await h.run('auto')
  await h.until(()=>h.notices.some(m=>m.status==='ready' && m.state?.analyzedMessageId==='a3'))
  expect(h.requests.map(r=>JSON.parse(r.messages[1].content).turn.at(-1).content)).toEqual(['The market closes.','The door opens.'])
  expect(h.notices.at(-1)!.internalState.sections.world).toContain('<ct>30</ct>')
  expect(h.notices.some(m=>m.status==='stale')).toBe(false)
})

test('an assistant-only turn does not borrow an already processed user action', async()=>{
  const h = await harness([...old,msg('a2','assistant','The clerk waits.')])
  const status = await h.run()
  expect(status.status).toBe('ready')
  expect(JSON.parse(h.requests[0].messages[1].content).turn).toEqual([{role:'assistant',name:'Narrator',content:'The clerk waits.'}])
})

test('an invalid, interrupted or length-limited update never advances the saved turn', async()=>{
  const h = await harness([...old,msg('u2','user','I wait.'),msg('a2','assistant','The rain stops.')])
  for(const out of [
    {next:{statePatch:{world:{weather:'Clear'}},mapPatch:{movePins:[{scale:'local',name:'Nobody',toTile:'missing'}]}}},
    {next:quiet, finish:'length'},
    {next:quiet, unfinished:true},
  ]) {
    Object.assign(h.result,{finish:undefined,unfinished:false},out)
    expect((await h.run()).status).toBe('error')
    expect(h.writes).toHaveLength(0)
  }
})

test('a trailing player action cannot cause manual Analyze to reuse the old reply', async()=>{
  const h = await harness([...old,msg('u2','user','I have not received a reply yet.')])
  expect((await h.run()).message).toMatch(/no current assistant/i)
  expect(h.requests).toHaveLength(0)
  expect(h.writes).toHaveLength(0)
})

test('a malformed new-format record never falls back to its old checkpoint', async()=>{
  const h = await harness([...old,msg('a2','assistant','Go on.')],{[legacyKey]:legacy(),[jsonKey]:{schema:2,state:{chatId:chat}}})
  expect((await h.run()).status).toBe('error')
  expect(h.requests).toHaveLength(0)
  expect(h.writes).toHaveLength(0)
})
