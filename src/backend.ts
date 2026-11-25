import {
  cleanText,
  emptyAtlasState,
} from './geometry.js'
import { migrateLastInternalState, applyStateDelta, type InternalState } from './internal-state.js'
import { applyMapDelta } from './map-delta.js'
import { assessGeneration, sameSourceRevision, type GenerationStart } from './generation-policy.js'
import { buildRebuildPrompt, extractUnifiedDelta, REBUILD_SYSTEM_PROMPT } from './unified-prompt.js'
import { ANALYZE_SYSTEM_PROMPT, prepareAnalyze, finishAnalyze, turnStart, sameStoryInput, type StoryRevision } from './analyze-turn.js'
import { encodeStoredState, decodeStoredState, type StoredStateV2 } from './state-storage.js'
import { prepareSimulationInterceptorResult } from './context-bridge.js'
import type { PromptMessage } from './prompt.js'
import type {
  AtlasState,
  BackendToFrontendMessage,
  ChatConfig,
  ConnectionOption,
  EffectiveConfig,
  FrontendToBackendMessage,
  MapLayer,
  Scale,
  ChatRecord,
  UserConfig,
} from './types.js'

declare const spindle: import('lumiverse-spindle-types').SpindleAPI

const STORAGE_ROOT = 'lumi-atlas-v1'
const MAX_ARCHIVES = 20
const ANALYSIS_IDLE_TIMEOUT_MS = 180_000
const ANALYSIS_MAX_TIMEOUT_MS = 600_000
const MESSAGE_TAIL = 14
const STREAM_THROTTLE_MS = 140

interface Origin {
  sessionId?: string
}

interface ActiveGeneration {
  id: string
  sessionId?: string
  start: GenerationStart
}

interface ChatRuntime {
  userId: string
  chatId: string
  epoch: number
  queue: Promise<void>
  record?: ChatRecord
  busy: boolean
  controller?: AbortController
  timer?: ReturnType<typeof setTimeout>
  generation?: ActiveGeneration
}

const runtimes = new Map<string, ChatRuntime>()
let generationUnsubs: Array<() => void> = []
let interceptorUnsub: (() => void) | null = null

function validUserId(userId: unknown): userId is string {
  return typeof userId === 'string' && userId.length > 0 && userId.length <= 256 && !/[\u0000-\u001f]/.test(userId)
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function getRuntime(userId: string, chatId: string): ChatRuntime {
  const key = `${userId}::${chatId}`
  let rt = runtimes.get(key)
  if (!rt) {
    rt = { userId, chatId, epoch: 0, queue: Promise.resolve(), busy: false }
    runtimes.set(key, rt)
  }
  return rt
}

function enqueue<T>(rt: ChatRuntime, fn: () => Promise<T>): Promise<T> {
  const next = rt.queue.then(fn, fn)
  rt.queue = next.then(() => undefined, () => undefined)
  return next
}

function userConfigPath(): string {
  return `${STORAGE_ROOT}/config.json`
}

function chatRecordPath(chatId: string): string {
  return `lumi-atlas-v2/chats/${chatId}.json`
}

type DiskChat = Omit<ChatRecord, 'internalState'> & (
  {schema: 1; internalState?: InternalState} | {schema: 2; internalState?: StoredStateV2}
)

async function readDiskChat(path: string, userId: string): Promise<DiskChat | null> {
  // Only a missing file permits fallback. A corrupt current file must never
  // resurrect an older checkpoint. The real Spindle API distinguishes existence.
  if (typeof spindle.userStorage.exists === 'function') {
    if (!await spindle.userStorage.exists(path, userId)) return null
    const data = await spindle.userStorage.getJson<DiskChat>(path, {userId})
    if (!data) throw new Error('Stored chat is empty.')
    return data
  }
  return spindle.userStorage.getJson<DiskChat | null>(path, {userId, fallback:null})
}

function defaultChatRecord(chatId: string): ChatRecord {
  return {
    config: { enabled: true, autoUpdate: true },
    state: emptyAtlasState(chatId),
    archives: { local: [], region: [], world: [] },
  }
}

function normalizeReasoningMode(raw: unknown): 'inherit' | 'off' {
  return raw === 'off' ? 'off' : 'inherit'
}

async function readUserConfig(userId: string): Promise<UserConfig> {
  try {
    const raw = await spindle.userStorage.getJson<Partial<UserConfig>>(userConfigPath(), {
      userId,
      fallback: { connectionId: null, reasoningMode: 'inherit' },
    })
    const connectionId = typeof raw?.connectionId === 'string' && raw.connectionId.trim() ? raw.connectionId.trim() : null
    return { connectionId, reasoningMode: normalizeReasoningMode(raw?.reasoningMode) }
  } catch {
    return { connectionId: null, reasoningMode: 'inherit' }
  }
}

async function writeUserConfig(userId: string, config: UserConfig): Promise<void> {
  await spindle.userStorage.setJson(userConfigPath(), config, { userId, indent: 2 })
}

async function loadChatRecord(rt: ChatRuntime): Promise<ChatRecord> {
  if (rt.record) return rt.record
  try {
    const v2 = await readDiskChat(chatRecordPath(rt.chatId), rt.userId)
    const raw = v2 ?? await readDiskChat(`${STORAGE_ROOT}/chats/${rt.chatId}.json`, rt.userId)
    if (raw !== null) {
      const s = raw.state
      if (raw.schema !== (v2 === null ? 1 : 2) || s?.chatId !== rt.chatId || s.version !== 1 || !s.maps ||
          !(['local','region','world'] as const).every(scale => Array.isArray(s.maps[scale]?.tiles) && Array.isArray(s.maps[scale]?.roads)) ||
          (raw.schema === 2 && Boolean(s.analyzedMessageId) && !raw.internalState)) {
        throw new Error('Stored chat record is malformed; refusing to replace it.')
      }
      const record: ChatRecord = {
        config: {
          enabled: typeof raw.config?.enabled === 'boolean' ? raw.config.enabled : true,
          autoUpdate: raw.config?.autoUpdate !== false,
        },
        state: raw.state,
        archives: {
          local: Array.isArray(raw.archives?.local) ? raw.archives.local : [],
          region: Array.isArray(raw.archives?.region) ? raw.archives.region : [],
          world: Array.isArray(raw.archives?.world) ? raw.archives.world : [],
        },
        internalState: raw.internalState === undefined ? undefined
          : raw.schema === 2 ? decodeStoredState(raw.internalState) : applyStateDelta(raw.internalState, {}),
        sourceRevision: raw.sourceRevision,
        processedGenerationId: raw.processedGenerationId,
      }
      rt.record = record
      return record
    }
  } catch (err) {
    spindle.log.warn(`LumiAtlas: failed loading record for ${rt.chatId}: ${err instanceof Error ? err.message : String(err)}`)
    throw new Error('Could not read the saved Atlas; no changes were made.')
  }
  const fresh = defaultChatRecord(rt.chatId)
  rt.record = fresh
  return fresh
}

async function saveChatRecord(rt: ChatRuntime, record: ChatRecord): Promise<void> {
  const {internalState, ...rest} = record
  const disk: DiskChat = { ...rest, schema:2, ...(internalState ? {internalState:encodeStoredState(internalState)} : {}) }
  await spindle.userStorage.setJson(chatRecordPath(rt.chatId), disk, {
    userId: rt.userId,
    indent: 0,
  })
  rt.record = record
}

async function listConnections(userId: string): Promise<ConnectionOption[]> {
  if (!spindle.permissions.has('generation')) return []
  try {
    const list = await spindle.connections.list(userId)
    if (!Array.isArray(list)) return []
    return list
      .filter((c) => c && typeof c.id === 'string' && c.id)
      .map((c) => ({
        id: c.id,
        name: cleanText(c.name, 80) || c.id,
        model: cleanText(c.model, 80),
        provider: cleanText(c.provider, 40),
      }))
  } catch {
    return []
  }
}

async function getActiveChatId(userId: string): Promise<string | null> {
  if (!spindle.permissions.has('chats')) return null
  try {
    const active = await spindle.chats.getActive(userId)
    return active && typeof active.id === 'string' ? active.id : null
  } catch {
    return null
  }
}

function sendToUI(userId: string, payload: BackendToFrontendMessage, origin?: Origin): void {
  const canRouteSession = (spindle.host.capabilities['frontend-session-routing-v1'] ?? 0) >= 1
  if (origin?.sessionId && canRouteSession) {
    spindle.sendToFrontend(payload, userId, { frontendSessionId: origin.sessionId })
    return
  }
  spindle.sendToFrontend(payload, userId)
}

function emitStatus(
  userId: string,
  chatId: string | null,
  status: 'idle' | 'updating' | 'ready' | 'stale' | 'error',
  message: string,
  state?: AtlasState | null,
  config?: EffectiveConfig,
  origin?: Origin,
  archives?: Record<Scale, MapLayer[]>,
  internalState?: InternalState,
): void {
  sendToUI(userId, { type: 'status', chatId, status, message, state, archives, internalState, config }, origin)
}

function emitStream(
  userId: string,
  chatId: string,
  phase: 'thinking' | 'writing',
  reasoning: string,
  outputChars: number,
  outputTail: string,
  origin?: Origin,
): void {
  sendToUI(
    userId,
    {
      type: 'stream',
      chatId,
      phase,
      reasoning: reasoning.slice(-8000),
      outputChars,
      outputTail: outputTail.slice(-320),
    },
    origin,
  )
}

function cancelRuntime(rt: ChatRuntime, notifyMessage?: string, origin?: Origin): void {
  rt.epoch += 1
  if (rt.timer) {
    clearTimeout(rt.timer)
    rt.timer = undefined
  }
  if (rt.controller) {
    rt.controller.abort()
    rt.controller = undefined
  }
  const wasBusy = rt.busy
  rt.busy = false
  if (wasBusy && notifyMessage) {
    emitStatus(rt.userId, rt.chatId, 'idle', notifyMessage, rt.record?.state ?? null, undefined, origin)
  }
}

/** Strip noisy <style>/<script> blocks from messages while keeping prose & map/location data. */
export function prepareMessageText(raw: string): string {
  return raw
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<details\s+class=["']ldg-source["'][^>]*>[\s\S]*?<\/details>/gi, '')
    .replace(/<internal_states\b[^>]*>[\s\S]*?<\/internal_states\s*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface StoryRead {
  sources: StoryRevision[]
  latestSource: StoryRevision | undefined
  totalRead: number
  tailMayBePartial: boolean
}

async function readRecentMessages(chatId: string, full = false, throughId?: string): Promise<StoryRead> {
  const useLean = (spindle.host.capabilities['chat-lean-messages-v1'] ?? 0) >= 1
  const rawList = useLean
    ? await spindle.chat.getMessages(chatId, { ...(full ? {} : {tail: MESSAGE_TAIL}), light:true, includeExtra:false, ownMetadataOnly:true })
    : await spindle.chat.getMessages(chatId)
  if (!Array.isArray(rawList)) throw new Error('Could not read the chat transcript.')
  const tail = full ? rawList : rawList.slice(-MESSAGE_TAIL)
  const partial = !full && tail.length === MESSAGE_TAIL
  const end = throughId ? tail.findIndex(m => m.id === throughId) : tail.length - 1
  if (throughId && end < 0 && partial) return readRecentMessages(chatId, true, throughId)
  // Ignore a newer appended turn, but never substitute that turn for a missing source.
  const slice = throughId ? tail.slice(0, end + 1) : tail
  const visible = slice.filter(m => m && !m.hidden && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
  const sources: StoryRevision[] = visible.map(m => {
    if (!m.id) throw new Error('Cannot identify a visible chat message; previous simulation kept.')
    return {id:m.id, role:m.role, swipe_id:Number.isInteger(m.swipe_id) ? m.swipe_id : 0, content:m.content, ...(m.name ? {name:m.name} : {})}
  })
  // Legacy deleted-message reconciliation compares visible counts within the
  // recent raw tail, so a long full Rebuild must not store a full-history count.
  const tailCount = full ? slice.slice(-MESSAGE_TAIL).filter(m => m && !m.hidden && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').length : sources.length
  return {sources, latestSource:sources.at(-1), totalRead:tailCount, tailMayBePartial:partial}
}

function promptMessages(sources: readonly StoryRevision[], clean = true): PromptMessage[] {
  return sources.flatMap(m => {
    const content = clean ? prepareMessageText(m.content) : m.content
    return content ? [{role:m.role as 'user'|'assistant', content, ...(m.name?.trim() ? {name:m.name.trim()} : {})}] : []
  })
}

/** Read character card, active persona, and attached lorebook context when permissions are granted. */
async function readStoryBackground(
  chatId: string,
  userId: string,
  characterId?: string,
): Promise<{ context: string; personaName: string | null }> {
  const parts: string[] = []
  let personaName: string | null = null
  const clip = (raw: unknown, max: number): string =>
    typeof raw === 'string' ? raw.trim().slice(0, max) : ''

  let charWorldBookIds: string[] = []
  if (characterId && spindle.permissions.has('characters') && typeof spindle.characters?.get === 'function') {
    try {
      const char = await spindle.characters.get(characterId, userId)
      if (char) {
        const charLines: string[] = []
        if (char.name) charLines.push(`Name: ${char.name}`)
        const desc = clip(char.description, 4500)
        if (desc) charLines.push(`Description:\n${desc}`)
        const pers = clip(char.personality, 1500)
        if (pers) charLines.push(`Personality:\n${pers}`)
        const scen = clip(char.scenario, 2500)
        if (scen) charLines.push(`Scenario:\n${scen}`)
        if (charLines.length) parts.push(`[CHARACTER CARD]\n${charLines.join('\n')}`)
        if (Array.isArray(char.world_book_ids)) charWorldBookIds = char.world_book_ids.filter((id): id is string => typeof id === 'string' && Boolean(id))
      }
    } catch (err) {
      spindle.log.warn(`LumiAtlas: could not read character card: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (spindle.permissions.has('personas') && typeof spindle.personas?.getActive === 'function') {
    try {
      const persona = (await spindle.personas.getActive(userId)) ?? (typeof spindle.personas.getDefault === 'function' ? await spindle.personas.getDefault(userId) : null)
      if (persona) {
        if (typeof persona.name === 'string' && persona.name.trim()) personaName = persona.name.trim()
        const pLines: string[] = []
        if (personaName) pLines.push(`Name: ${personaName}`)
        const title = clip(persona.title, 200)
        if (title) pLines.push(`Title: ${title}`)
        const desc = clip(persona.description, 2500)
        if (desc) pLines.push(`Description:\n${desc}`)
        if (pLines.length) parts.push(`[PLAYER PERSONA]\n${pLines.join('\n')}`)
      }
    } catch (err) {
      spindle.log.warn(`LumiAtlas: could not read active persona: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (spindle.permissions.has('world_books') && spindle.world_books) {
    try {
      const loreLines: string[] = []
      let budget = 6000
      const seenEntryIds = new Set<string>()
      if (typeof spindle.world_books.getActivated === 'function' && typeof spindle.world_books.entries?.get === 'function') {
        const activated = await spindle.world_books.getActivated(chatId, userId)
        for (const item of Array.isArray(activated) ? activated.slice(0, 12) : []) {
          if (!item?.id || seenEntryIds.has(item.id) || budget <= 200) continue
          seenEntryIds.add(item.id)
          const entry = await spindle.world_books.entries.get(item.id, userId)
          const body = clip(entry?.content, Math.min(1200, budget))
          if (!body) continue
          const label = clip(entry?.comment || item.comment || item.keys?.join(', '), 80) || 'Lore'
          loreLines.push(`- ${label}: ${body}`)
          budget -= body.length + label.length + 6
        }
      }
      if (budget > 600 && charWorldBookIds.length && typeof spindle.world_books.entries?.list === 'function') {
        for (const bookId of charWorldBookIds.slice(0, 2)) {
          if (budget <= 400) break
          const listed = await spindle.world_books.entries.list(bookId, { limit: 25, userId })
          const entries = Array.isArray(listed?.data) ? listed.data : []
          const prioritized = [
            ...entries.filter((e) => e && !e.disabled && e.constant),
            ...entries.filter((e) => e && !e.disabled && !e.constant),
          ]
          for (const entry of prioritized) {
            if (!entry?.id || seenEntryIds.has(entry.id) || budget <= 200) continue
            seenEntryIds.add(entry.id)
            const body = clip(entry.content, Math.min(1000, budget))
            if (!body) continue
            const label = clip(entry.comment || (Array.isArray(entry.key) ? entry.key.join(', ') : ''), 80) || 'Lore'
            loreLines.push(`- ${label}: ${body}`)
            budget -= body.length + label.length + 6
          }
        }
      }
      if (loreLines.length) parts.push(`[WORLD LORE]\n${loreLines.join('\n')}`)
    } catch (err) {
      spindle.log.warn(`LumiAtlas: could not read world books: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { context: parts.join('\n\n').slice(0, 14000), personaName }
}

function archiveLayerIfChanged(record: ChatRecord, nextState: AtlasState): Record<Scale, MapLayer[]> {
  const archives: Record<Scale, MapLayer[]> = {
    local: [...record.archives.local],
    region: [...record.archives.region],
    world: [...record.archives.world],
  }

  for (const scale of ['local', 'region', 'world'] as Scale[]) {
    const prevLayer = record.state.maps[scale]
    const nextLayer = nextState.maps[scale]
    if (prevLayer.tiles.length > 0 && prevLayer.id !== nextLayer.id) {
      archives[scale] = [prevLayer, ...archives[scale].filter((l) => l.id !== prevLayer.id)].slice(0, MAX_ARCHIVES)
    }
  }
  return archives
}

/** A blank but fully-shaped simulation record for chats without legacy state. */
function blankInternalState(): InternalState {
  return {
    sections: {
      world: '<state:world></state:world>',
      onscreen: '<state:onscreen></state:onscreen>',
      offscreen_agendas: '<state:offscreen_agendas></state:offscreen_agendas>',
      locations: '<state:locations></state:locations>',
      entityMem: '<state:entityMem></state:entityMem>',
      entity_state: '<state:entity_state></state:entity_state>',
      thoughts: '<state:thoughts></state:thoughts>',
      dam: '<state:dam></state:dam>',
      pair: '<state:pair></state:pair>',
      reputation: '<state:reputation></state:reputation>',
      tracks: '<state:tracks></state:tracks>',
      arc: '<state:arc></state:arc>',
      chekhov: '<state:chekhov></state:chekhov>',
      leads: '<state:leads></state:leads>',
      inv: '<state:inv></state:inv>',
      story_notes: '<state:story_notes></state:story_notes>',
      notebook: '<state:notebook></state:notebook>',
      vent: '<state:vent></state:vent>',
    },
  }
}

function checkCompletion(reason: unknown): void {
  if (typeof reason === 'string' && /^(length|max_tokens|max_output_tokens|content_filter|error|cancelled|canceled|tool_calls)$/i.test(reason)) {
    throw new Error(`Sidecar did not finish the patch (${reason}). Previous Atlas kept.`)
  }
}

function extractResponseContent(result: unknown): string {
  if (typeof result === 'string') return result
  if (!result || typeof result !== 'object') return ''
  const obj = result as Record<string, unknown>
  checkCompletion(obj.finish_reason)
  if (Array.isArray(obj.choices)) checkCompletion(obj.choices[0]?.finish_reason)
  if (typeof obj.content === 'string') return obj.content
  if (typeof obj.text === 'string') return obj.text
  if (Array.isArray(obj.choices)) {
    const first = obj.choices[0] as Record<string, unknown> | undefined
    const msg = first?.message as Record<string, unknown> | undefined
    if (typeof msg?.content === 'string') return msg.content
  }
  return ''
}

async function runAnalysis(
  rt: ChatRuntime,
  mode: 'update' | 'rebuild',
  trigger: 'auto' | 'manual',
  origin?: Origin,
  expected?: { messageId: string; generationId: string },
): Promise<void> {
  const myEpoch = rt.epoch
  let controller: AbortController | null = null
  let fallbackState: AtlasState | null = rt.record?.state ?? null
  let runId = `run_${Date.now()}`
  let timedOut = false
  let startedAt = Date.now()

  try {
    if (!spindle.permissions.has('generation')) {
      if (trigger === 'manual') {
        emitStatus(rt.userId, rt.chatId, 'error', 'Grant the "generation" permission in Extensions to analyze maps.', fallbackState, undefined, origin)
      }
      return
    }
    if (!spindle.permissions.has('chats')) {
      if (trigger === 'manual') {
        emitStatus(rt.userId, rt.chatId, 'error', 'Grant the "chats" permission in Extensions to access chats.', fallbackState, undefined, origin)
      }
      return
    }
    if (!spindle.permissions.has('chat_mutation')) {
      if (trigger === 'manual') {
        emitStatus(rt.userId, rt.chatId, 'error', 'Grant the "chat_mutation" permission in Extensions so LumiAtlas can read chat messages.', fallbackState, undefined, origin)
      }
      return
    }

    const userConfig = await readUserConfig(rt.userId)
    const record = await loadChatRecord(rt)
    fallbackState = record.state
    const effectiveConfig: EffectiveConfig = {
      ...record.config,
      connectionId: userConfig.connectionId,
      reasoningMode: userConfig.reasoningMode ?? 'inherit',
    }

    if (trigger === 'auto' && (!record.config.enabled || !record.config.autoUpdate)) return

    if (!userConfig.connectionId) {
      emitStatus(rt.userId, rt.chatId, 'error', 'Pick a background connection (e.g. Terra) in Settings first.', record.state, effectiveConfig, origin, record.archives, record.internalState)
      return
    }

    const connections = await listConnections(rt.userId)
    const chosen = connections.find((c) => c.id === userConfig.connectionId)
    if (!chosen) {
      emitStatus(rt.userId, rt.chatId, 'error', 'Selected background connection is unavailable. Pick another in Settings.', record.state, effectiveConfig, origin, record.archives, record.internalState)
      return
    }

    const chatMeta = await spindle.chats.get(rt.chatId, rt.userId)
    if (!chatMeta) throw new Error('Chat is unavailable for this user.')
    if ((!expected && rt.generation) || myEpoch !== rt.epoch) {
      if (trigger === 'manual') emitStatus(rt.userId, rt.chatId, 'idle', 'Wait for the current RP reply to finish before analyzing.', record.state, effectiveConfig, origin)
      return
    }
    if (record.state.stale && mode !== 'rebuild') {
      emitStatus(rt.userId, rt.chatId, 'stale', record.state.staleReason || 'Chat history diverged. Use Rebuild.', record.state, effectiveConfig, origin, record.archives, record.internalState)
      return
    }
    // Sparseness is NOT a reason to initialize again. A valid previous turn can
    // intentionally have empty sections or layers for the entire story.
    const heavy = mode === 'rebuild' || !record.internalState || !record.state.analyzedMessageId
    let fullRead = heavy
    let history = await readRecentMessages(rt.chatId, fullRead, expected?.messageId)
    if (!heavy && history.tailMayBePartial && turnStart(history.sources) === 0) {
      fullRead = true // e.g. many hidden messages or several consecutive user actions
      history = await readRecentMessages(rt.chatId, true, expected?.messageId)
    }
    const {latestSource, sources} = history
    if (!latestSource || latestSource.role !== 'assistant' || !prepareMessageText(latestSource.content)) {
      emitStatus(rt.userId, rt.chatId, 'error', 'No current assistant reply to simulate yet.', record.state, effectiveConfig, origin, record.archives, record.internalState)
      return
    }
    if (expected && latestSource.id !== expected.messageId) throw new Error('Reply changed before simulation started. Previous state kept.')
    if (trigger === 'auto' && expected && record.processedGenerationId === expected.generationId) return
    if (!heavy && record.sourceRevision && sameSourceRevision(record.sourceRevision, latestSource)) {
      if (trigger === 'manual') emitStatus(rt.userId, rt.chatId, 'ready', 'This reply has already been analyzed; no model call needed.', record.state, effectiveConfig, origin, record.archives, record.internalState)
      return
    }
    const start = heavy ? 0 : turnStart(sources)
    if (!heavy) {
      const prior = sources[start - 1]
      if (!prior || prior.id !== record.state.analyzedMessageId || (record.sourceRevision && !sameSourceRevision(record.sourceRevision, prior))) {
        await markStale(rt, 'There are unprocessed or changed replies between this turn and the saved Atlas. Use Rebuild to include them; your last Atlas is kept.', origin)
        return
      }
    }
    const messages = promptMessages(sources.slice(start))
    const baseMap = mode === 'rebuild' ? emptyAtlasState(rt.chatId) : record.state
    let seedState = mode === 'rebuild' ? undefined : record.internalState
    if (!seedState) {
      const migrated = migrateLastInternalState(promptMessages(sources, false))
      seedState = Object.keys(migrated.sections).length || migrated.ledger ? migrated : blankInternalState()
    }
    const background = heavy ? await readStoryBackground(rt.chatId, rt.userId, chatMeta.character_id ?? undefined) : null
    if (myEpoch !== rt.epoch || (!expected && rt.generation)) return
    const update = heavy ? null : prepareAnalyze(messages, baseMap, seedState)
    const name = background?.personaName || [...messages].reverse().find(m => m.role === 'user' && m.name)?.name
    const userPrompt = update?.prompt ?? buildRebuildPrompt(messages, baseMap, seedState, name, background?.context)

    // Runs are serialized by enqueue. Only an actual cancellation should advance
    // the epoch; starting this job must not invalidate already queued turns.
    controller = new AbortController()
    rt.controller = controller
    rt.busy = true
    const activeController = controller
    timedOut = false
    startedAt = Date.now()
    const armIdleTimer = () => {
      if (rt.timer) clearTimeout(rt.timer)
      const remaining = ANALYSIS_MAX_TIMEOUT_MS - (Date.now() - startedAt)
      const waitMs = Math.max(1_000, Math.min(ANALYSIS_IDLE_TIMEOUT_MS, remaining))
      rt.timer = setTimeout(() => {
        timedOut = true
        activeController.abort()
      }, waitMs)
    }
    armIdleTimer()

    runId = (spindle.host.capabilities['uuid-v1'] ?? 0) >= 1 ? await spindle.uuid.v7() : `run_${Date.now()}`
    spindle.log.info(`LumiAtlas: starting ${heavy ? 'seed/rebuild' : 'turn diff'} (${runId}) on chat ${rt.chatId} via ${chosen.name} (${chosen.model})`)

    emitStatus(
      rt.userId,
      rt.chatId,
      'updating',
      heavy ? `Building the Atlas from the transcript with ${chosen.name}…` : `Checking the newest turn with ${chosen.name}…`,
      record.state,
      effectiveConfig,
      origin,
      record.archives,
    )

    const effectiveModel = chosen.model.trim()
    const genParams: Record<string, unknown> = { temperature: 0.2, max_tokens: 8192 }
    if (effectiveModel) genParams.model = effectiveModel
    const genRequest = {
      type: 'raw' as const,
      connection_id: chosen.id,
      ...(chosen.provider ? { provider: chosen.provider } : {}),
      ...(effectiveModel ? { model: effectiveModel } : {}),
      userId: rt.userId,
      messages: [
        { role: 'system' as const, content: heavy ? REBUILD_SYSTEM_PROMPT : ANALYZE_SYSTEM_PROMPT },
        { role: 'user' as const, content: userPrompt },
      ],
      parameters: genParams,
      reasoning: effectiveConfig.reasoningMode === 'off' ? { source: 'off' as const } : { source: 'inherit' as const },
      signal: controller.signal,
    } as Parameters<typeof spindle.generate.raw>[0]

    let content = ''
    if (typeof spindle.generate.rawStream === 'function') {
      let reasoningAcc = ''
      let contentAcc = ''
      let lastEmit = 0
      let completed = false
      emitStream(rt.userId, rt.chatId, 'thinking', '', 0, '', origin)
      for await (const chunk of spindle.generate.rawStream(genRequest)) {
        if (controller.signal.aborted || myEpoch !== rt.epoch) return
        armIdleTimer()
        if (chunk.type === 'reasoning') {
          reasoningAcc += chunk.token
        } else if (chunk.type === 'token') {
          contentAcc += chunk.token
        } else if (chunk.type === 'done') {
          checkCompletion(chunk.finish_reason)
          completed = true
          content = chunk.content || contentAcc
          if (chunk.reasoning && !reasoningAcc) reasoningAcc = chunk.reasoning
          emitStream(rt.userId, rt.chatId, 'writing', reasoningAcc, content.length, content, origin)
          break
        }
        const now = Date.now()
        if (now - lastEmit >= STREAM_THROTTLE_MS) {
          lastEmit = now
          emitStream(
            rt.userId,
            rt.chatId,
            contentAcc.length > 0 ? 'writing' : 'thinking',
            reasoningAcc,
            contentAcc.length,
            contentAcc,
            origin,
          )
        }
      }
      if (!completed) throw new Error('Sidecar stream ended before completion. Previous Atlas kept.')
    } else {
      const rawResult = await spindle.generate.raw(genRequest)
      if (controller.signal.aborted || myEpoch !== rt.epoch) return
      content = extractResponseContent(rawResult)
    }

    if (controller.signal.aborted || myEpoch !== rt.epoch) return

    if (!content.trim()) {
      throw new Error(`${chosen.name} returned an empty response.`)
    }

    let nextInternalState: InternalState
    let patchedAtlas: AtlasState
    let noStoryChanges = false
    if (update) {
      const next = finishAnalyze(content, baseMap, seedState, update.nextCt)
      nextInternalState = next.state
      patchedAtlas = next.map
      noStoryChanges = next.noStoryChanges
    } else {
      const parsed = extractUnifiedDelta(content)
      nextInternalState = applyStateDelta(seedState, parsed.statePatch)
      patchedAtlas = applyMapDelta(baseMap, parsed.mapPatch)
    }
    const nextState: AtlasState = {
      ...patchedAtlas,
      updatedAt: new Date().toISOString(),
      analyzedMessageId: latestSource.id,
      analyzedMessageCount: history.totalRead,
      stale: false,
      staleReason: '',
    }
    const nextRecord: ChatRecord = {
      ...record,
      state: nextState,
      internalState: nextInternalState,
      sourceRevision: latestSource,
      processedGenerationId: expected?.generationId,
      archives: archiveLayerIfChanged(record, nextState),
    }

    if (controller.signal.aborted || myEpoch !== rt.epoch) return
    let latest = await readRecentMessages(rt.chatId, fullRead, latestSource.id)
    if (!heavy && latest.tailMayBePartial && turnStart(latest.sources) === 0) latest = await readRecentMessages(rt.chatId, true, latestSource.id)
    const verifyStart = heavy ? 0 : Math.max(0, turnStart(latest.sources) - 1)
    if (!sameStoryInput(sources.slice(Math.max(0, start - 1)), latest.sources.slice(verifyStart))) {
      const reason = 'The transcript changed during simulation. Previous Atlas kept; use Rebuild to reconcile.'
      if (record.state.analyzedMessageId) await markStale(rt, reason, origin)
      else emitStatus(rt.userId, rt.chatId, 'error', 'The transcript changed during initialization. Nothing was saved; retry Analyze.', record.state, effectiveConfig, origin)
      return
    }
    if (controller.signal.aborted || myEpoch !== rt.epoch) return
    try {
      await saveChatRecord(rt, nextRecord)
    } catch {
      rt.record = { ...record, state: { ...record.state, stale: true, staleReason: 'Simulation save could not be confirmed.' } }
      throw new Error('Simulation save could not be confirmed. Refresh before retrying.')
    }
    if (controller.signal.aborted || myEpoch !== rt.epoch) {
      await markStale(rt, 'Chat changed while simulation was being saved. Verify or rebuild.', origin)
      return
    }

    const counts = `${nextState.maps.local.tiles.length} local · ${nextState.maps.region.tiles.length} region · ${nextState.maps.world.tiles.length} world`
    emitStatus(
      rt.userId,
      rt.chatId,
      'ready',
      `${noStoryChanges ? 'Turn checked — no story changes' : heavy ? `Atlas built (${counts})` : 'Turn changes saved'} · ${((Date.now() - startedAt) / 1000).toFixed(1)}s · ${content.length} JSON chars.`,
      nextState,
      effectiveConfig,
      origin,
      nextRecord.archives,
      nextRecord.internalState,
    )
  } catch (err) {
    if (controller && myEpoch !== rt.epoch) return
    const isAbort = Boolean(controller?.signal.aborted) || (err instanceof Error && err.name === 'AbortError')
    const detail = timedOut
      ? `Atlas update timed out after ${Math.round((Date.now() - startedAt) / 1000)}s. Previous map kept.`
      : isAbort
        ? 'Atlas update was cancelled. Previous map kept.'
        : `Atlas update failed: ${err instanceof Error ? err.message : String(err)}`
    spindle.log.warn(`LumiAtlas (${runId}): ${detail}`)
    emitStatus(rt.userId, rt.chatId, 'error', detail, fallbackState, undefined, origin)
  } finally {
    if (rt.timer) {
      clearTimeout(rt.timer)
      rt.timer = undefined
    }
    if (controller && rt.controller === controller) {
      rt.controller = undefined
      rt.busy = false
    }
  }
}

async function markStale(rt: ChatRuntime, reason: string, origin?: Origin): Promise<void> {
  const record = await loadChatRecord(rt)
  if (!record.state.analyzedMessageId) return
  if (record.state.stale && record.state.staleReason === reason) return
  const next: ChatRecord = {
    ...record,
    state: {
      ...record.state,
      stale: true,
      staleReason: reason,
    },
  }
  await saveChatRecord(rt, next)
  emitStatus(rt.userId, rt.chatId, 'stale', reason, next.state, undefined, origin, next.archives, next.internalState)
}

function eventRuntime(payload: unknown, userId?: string): ChatRuntime | null {
  if (!validUserId(userId) || !payload || typeof payload !== 'object') return null
  const chatId = (payload as Record<string, unknown>).chatId
  if (!validId(chatId)) return null
  return getRuntime(userId, chatId)
}

function eventOrigin(payload: unknown): Origin | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const sid = (payload as Record<string, unknown>).frontendSessionId
  return typeof sid === 'string' && sid.length > 0 && sid.length <= 256 ? { sessionId: sid } : undefined
}

function registerGenerationEvents(): void {
  if (generationUnsubs.length > 0 || !spindle.permissions.has('generation')) return

  generationUnsubs.push(
    spindle.on('GENERATION_STARTED', (payload, userId) => {
      const rt = eventRuntime(payload, userId)
      if (!rt) return
      const row = payload as unknown as Record<string, unknown>
      if (row.backgroundSwipe === true || row.extensionId || typeof row.generationId !== 'string' || !row.generationId) return
      // Normal turns append. Keep a previous pinned diff running; its successor
      // queues behind the atomic commit. Only history-replacing runs invalidate it.
      rt.generation = { id: row.generationId, sessionId: eventOrigin(payload)?.sessionId, start: row }
      if (typeof row.generationType === 'string' && ['swipe', 'regenerate', 'continue'].includes(row.generationType)) {
        cancelRuntime(rt)
        void enqueue(rt, () => markStale(rt, 'A previous reply was regenerated or changed. Simulation must be reconciled.', eventOrigin(payload)))
      }
    }),
  )

  generationUnsubs.push(
    spindle.on('GENERATION_ENDED', (payload, userId) => {
      const rt = eventRuntime(payload, userId)
      if (!rt) return
      const row = payload as unknown as Record<string, unknown>
      if (!rt.generation || rt.generation.id !== row.generationId) return
      const active = rt.generation
      rt.generation = undefined
      const decision = assessGeneration(active.start, row)
      if (!decision.eligible || !decision.messageId) return
      const epochAtCompletion = rt.epoch
      void enqueue(rt, async () => {
        if (rt.epoch !== epochAtCompletion) return
        await runAnalysis(rt, 'update', 'auto', active.sessionId ? { sessionId: active.sessionId } : undefined,
          { messageId: decision.messageId!, generationId: active.id })
      })
    }),
  )

  generationUnsubs.push(
    spindle.on('GENERATION_STOPPED', (payload, userId) => {
      const rt = eventRuntime(payload, userId)
      if (!rt) return
      const row = payload as unknown as Record<string, unknown>
      if (rt.generation && rt.generation.id === row.generationId) {
        rt.generation = undefined
      }
    }),
  )
}

function registerSimulationInterceptor(): void {
  if (interceptorUnsub || !spindle.permissions.has('interceptor')) return
  interceptorUnsub = spindle.registerInterceptor(async (messages, context) => {
    if (!context || !validUserId(context.userId) || !validId(context.chatId)) return messages
    try {
      if (!await spindle.chats.get(context.chatId, context.userId)) return messages
      const rt = getRuntime(context.userId, context.chatId)
      const record = await loadChatRecord(rt)
      if (!record.config.enabled || record.state.stale || !record.internalState) return messages
      const prepared = prepareSimulationInterceptorResult(messages, record.internalState)
      if (!prepared.compatible) {
        spindle.log.warn(`LumiAtlas interceptor skipped chat ${context.chatId}: ${prepared.reason}`)
        return messages
      }
      return prepared.output
    } catch (err) {
      spindle.log.warn(`LumiAtlas context unavailable: ${err instanceof Error ? err.message : String(err)}`)
      return messages
    }
  }, 60)
}

registerGenerationEvents()
registerSimulationInterceptor()

spindle.permissions.onChanged(({ permission, granted }) => {
  if (permission === 'interceptor') {
    if (granted) registerSimulationInterceptor()
    else { interceptorUnsub?.(); interceptorUnsub = null }
    return
  }
  if (permission !== 'generation') return
  if (granted) {
    registerGenerationEvents()
  } else {
    for (const off of generationUnsubs) off()
    generationUnsubs = []
    for (const rt of runtimes.values()) {
      cancelRuntime(rt)
      rt.generation = undefined
    }
  }
})

function eventMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Record<string, unknown>
  if (typeof row.messageId === 'string' && row.messageId) return row.messageId
  const msg = row.message
  if (msg && typeof msg === 'object' && typeof (msg as Record<string, unknown>).id === 'string') {
    const id = (msg as Record<string, unknown>).id as string
    if (id) return id
  }
  return null
}

async function reconcileHistoryEvent(
  rt: ChatRuntime,
  eventName: 'MESSAGE_EDITED' | 'MESSAGE_DELETED' | 'MESSAGE_SWIPED' | 'SWIPE_EDITED',
  payload: unknown,
): Promise<void> {
  const record = await loadChatRecord(rt)
  const analyzedId = record.sourceRevision?.id ?? record.state.analyzedMessageId
  if (!analyzedId) return

  const { sources, totalRead } = await readRecentMessages(rt.chatId)
  const analyzedIdx = sources.findIndex((s) => s.id === analyzedId)
  const msgId = eventMessageId(payload)

  if (eventName === 'MESSAGE_DELETED') {
    const analyzedIntact =
      analyzedIdx >= 0 &&
      (!record.sourceRevision || sameSourceRevision(record.sourceRevision, sources[analyzedIdx])) &&
      totalRead >= record.state.analyzedMessageCount
    if (analyzedIntact) return
    cancelRuntime(rt)
    await markStale(rt, 'Chat history changed (edit, delete, or swipe). Use Rebuild to re-simulate from the current transcript.', eventOrigin(payload))
    return
  }

  if (analyzedIdx >= 0) {
    if (record.sourceRevision && !sameSourceRevision(record.sourceRevision, sources[analyzedIdx])) {
      cancelRuntime(rt)
      await markStale(rt, 'Chat history changed (edit, delete, or swipe). Use Rebuild to re-simulate from the current transcript.', eventOrigin(payload))
      return
    }
    // Metadata-only update or background swipe on the analyzed message without changing active text/swipe
    if (msgId && msgId === analyzedId) return
    // Edit/update on a newer message after the last analyzed turn (e.g. normal reply finalization)
    const eventIdx = msgId ? sources.findIndex((s) => s.id === msgId) : -1
    if (eventIdx > analyzedIdx) return
    // If a normal generation is actively running and payload omitted messageId, ignore until GENERATION_ENDED
    if (!msgId && rt.generation && (rt.generation.start.generationType === undefined || rt.generation.start.generationType === 'normal')) return
  } else if (msgId && sources.some((s) => s.id === msgId)) {
    // Analyzed message is older than the recent tail, while the edited message is in the recent tail (newer)
    return
  }

  cancelRuntime(rt)
  await markStale(rt, 'Chat history changed (edit, delete, or swipe). Use Rebuild to re-simulate from the current transcript.', eventOrigin(payload))
}

for (const ev of ['MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'SWIPE_EDITED'] as const) {
  spindle.on(ev, (payload, userId) => {
    const rt = eventRuntime(payload, userId)
    if (!rt) return
    void enqueue(rt, () => reconcileHistoryEvent(rt, ev, payload))
  })
}

spindle.onFrontendMessage(async (payload: unknown, userId: string, frontendSessionId?: string) => {
  if (!validUserId(userId) || !payload || typeof payload !== 'object') return
  const msg = payload as FrontendToBackendMessage
  const origin: Origin | undefined =
    typeof frontendSessionId === 'string' && frontendSessionId.length > 0 && frontendSessionId.length <= 256
      ? { sessionId: frontendSessionId }
      : undefined

  try {
    if (msg.type === 'init') {
      const activeChatId =
        (typeof msg.chatId === 'string' && validId(msg.chatId) ? msg.chatId : null) ??
        (await getActiveChatId(userId))
      const [userConfig, connections] = await Promise.all([
        readUserConfig(userId),
        listConnections(userId),
      ])

      if (!activeChatId) {
        sendToUI(
          userId,
          {
            type: 'init',
            requestId: msg.requestId ?? null,
            activeChatId: null,
            config: {
              enabled: false,
              autoUpdate: true,
              connectionId: userConfig.connectionId,
              reasoningMode: userConfig.reasoningMode ?? 'inherit',
            },
            connections,
            state: null,
            archives: { local: [], region: [], world: [] },
            busy: false,
            statusMessage: 'Open a chat to view its Atlas.',
            error: null,
          },
          origin,
        )
        return
      }

      const rt = getRuntime(userId, activeChatId)
      if (!await spindle.chats.get(activeChatId, userId)) {
        emitStatus(userId, activeChatId, 'error', 'Chat is unavailable for this user.', undefined, undefined, origin)
        return
      }
      const record = await loadChatRecord(rt)
      const effective: EffectiveConfig = {
        ...record.config,
        connectionId: userConfig.connectionId,
        reasoningMode: userConfig.reasoningMode ?? 'inherit',
      }
      const statusMessage = rt.busy
        ? 'Checking the simulation…'
        : record.state.stale
          ? record.state.staleReason
          : record.state.analyzedMessageId
            ? `Current: ${record.state.currentLocation}`
            : 'Ready to chart. Click Analyze to build the 3-layer Atlas.'

      sendToUI(
        userId,
        {
          type: 'init',
          requestId: msg.requestId ?? null,
          activeChatId,
          config: effective,
          connections,
          state: record.state,
          archives: record.archives,
          internalState: record.internalState,
          busy: rt.busy,
          statusMessage,
          error: null,
        },
        origin,
      )
      return
    }

    if (msg.type === 'set_connection') {
      const connectionId = typeof msg.connectionId === 'string' && msg.connectionId.trim() ? msg.connectionId.trim() : null
      if (connectionId) {
        const connections = await listConnections(userId)
        if (!connections.some((c) => c.id === connectionId)) {
          emitStatus(userId, await getActiveChatId(userId), 'error', 'Selected connection was not found.', undefined, undefined, origin)
          return
        }
      }
      const prevUserConfig = await readUserConfig(userId)
      const reasoningMode = prevUserConfig.reasoningMode ?? 'inherit'
      await writeUserConfig(userId, { connectionId, reasoningMode })
      const activeChatId = await getActiveChatId(userId)
      const rt = activeChatId ? getRuntime(userId, activeChatId) : null
      const record = rt ? await loadChatRecord(rt) : null
      emitStatus(
        userId,
        activeChatId,
        'ready',
        connectionId ? 'Background connection saved.' : 'Background connection cleared.',
        record?.state ?? null,
        {
          enabled: record?.config.enabled ?? false,
          autoUpdate: record?.config.autoUpdate ?? true,
          connectionId,
          reasoningMode,
        },
        origin,
        record?.archives,
      )
      return
    }

    if (msg.type === 'set_reasoning_mode') {
      const reasoningMode = normalizeReasoningMode(msg.reasoningMode)
      const prevUserConfig = await readUserConfig(userId)
      await writeUserConfig(userId, { connectionId: prevUserConfig.connectionId, reasoningMode })
      const activeChatId = await getActiveChatId(userId)
      const rt = activeChatId ? getRuntime(userId, activeChatId) : null
      const record = rt ? await loadChatRecord(rt) : null
      emitStatus(
        userId,
        activeChatId,
        'ready',
        reasoningMode === 'off'
          ? 'Reasoning disabled (faster, direct JSON).'
          : 'Reasoning enabled (inherits connection thinking settings).',
        record?.state ?? null,
        {
          enabled: record?.config.enabled ?? false,
          autoUpdate: record?.config.autoUpdate ?? true,
          connectionId: prevUserConfig.connectionId,
          reasoningMode,
        },
        origin,
        record?.archives,
      )
      return
    }

    if (msg.type === 'set_chat_config') {
      if (!validId(msg.chatId)) return
      const rt = getRuntime(userId, msg.chatId)
      const userConfig = await readUserConfig(userId)
      await enqueue(rt, async () => {
        const record = await loadChatRecord(rt)
        const nextConfig: ChatConfig = {
          enabled: typeof msg.enabled === 'boolean' ? msg.enabled : record.config.enabled,
          autoUpdate: typeof msg.autoUpdate === 'boolean' ? msg.autoUpdate : record.config.autoUpdate,
        }
        if (!nextConfig.enabled) cancelRuntime(rt)
        const nextRecord: ChatRecord = { ...record, config: nextConfig }
        await saveChatRecord(rt, nextRecord)
        emitStatus(
          userId,
          msg.chatId,
          'ready',
          nextConfig.enabled
            ? nextConfig.autoUpdate
              ? 'Atlas enabled (auto-updates after replies).'
              : 'Atlas enabled (manual updates only).'
            : 'Atlas paused for this chat.',
          nextRecord.state,
          {
            ...nextConfig,
            connectionId: userConfig.connectionId,
            reasoningMode: userConfig.reasoningMode ?? 'inherit',
          },
          origin,
          nextRecord.archives,
        )
      })
      return
    }

    if (msg.type === 'analyze') {
      if (!validId(msg.chatId)) return
      const rt = getRuntime(userId, msg.chatId)
      const mode = msg.mode === 'rebuild' ? 'rebuild' : 'update'
      void enqueue(rt, () => runAnalysis(rt, mode, 'manual', origin))
      return
    }

    if (msg.type === 'cancel') {
      if (!validId(msg.chatId)) return
      const rt = getRuntime(userId, msg.chatId)
      cancelRuntime(rt, 'Atlas update cancelled.', origin)
      return
    }
  } catch (err) {
    spindle.log.error(`LumiAtlas message handler error: ${err instanceof Error ? err.message : String(err)}`)
    emitStatus(
      userId,
      await getActiveChatId(userId),
      'error',
      err instanceof Error ? err.message : 'Unexpected LumiAtlas error.',
      undefined,
      undefined,
      origin,
    )
  }
})

export const __testing = {
  prepareMessageText,
  extractResponseContent,
  archiveLayerIfChanged,
  defaultChatRecord,
}

spindle.log.info('LumiAtlas backend loaded')
