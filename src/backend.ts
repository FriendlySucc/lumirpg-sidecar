import {
  cleanText,
  emptyAtlasState,
  sanitizeProposal,
} from './geometry.js'
import { migrateLastInternalState, applyStateDelta, type InternalState } from './internal-state.js'
import { applyMapDelta } from './map-delta.js'
import { assessGeneration, sameSourceRevision, type GenerationStart, type SourceRevision } from './generation-policy.js'
import { buildUnifiedPrompt, extractUnifiedDelta, UNIFIED_SYSTEM_PROMPT } from './unified-prompt.js'
import { prepareSimulationContext } from './context-bridge.js'
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
  StoredChatRecord,
  UserConfig,
} from './types.js'

declare const spindle: import('lumiverse-spindle-types').SpindleAPI

const STORAGE_ROOT = 'lumi-atlas-v1'
const MAX_ARCHIVES = 20
const ANALYSIS_TIMEOUT_MS = 180_000
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
  record?: StoredChatRecord
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
  return `${STORAGE_ROOT}/chats/${chatId}.json`
}

function defaultChatRecord(chatId: string): StoredChatRecord {
  return {
    schema: 1,
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

async function loadChatRecord(rt: ChatRuntime): Promise<StoredChatRecord> {
  if (rt.record) return rt.record
  try {
    const raw = await spindle.userStorage.getJson<Partial<StoredChatRecord> | null>(
      chatRecordPath(rt.chatId),
      { userId: rt.userId, fallback: null },
    )
    if (raw && raw.schema === 1 && raw.state && raw.state.chatId === rt.chatId) {
      const record: StoredChatRecord = {
        schema: 1,
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
        internalState: raw.internalState,
        sourceRevision: raw.sourceRevision,
        processedGenerationId: raw.processedGenerationId,
      }
      rt.record = record
      return record
    }
    if (raw !== null) throw new Error('Stored chat record is malformed; refusing to replace it.')
  } catch (err) {
    spindle.log.warn(`LumiAtlas: failed loading record for ${rt.chatId}: ${err instanceof Error ? err.message : String(err)}`)
    throw new Error('Could not read the saved Atlas; no changes were made.')
  }
  const fresh = defaultChatRecord(rt.chatId)
  rt.record = fresh
  return fresh
}

async function saveChatRecord(rt: ChatRuntime, record: StoredChatRecord): Promise<void> {
  await spindle.userStorage.setJson(chatRecordPath(rt.chatId), record, {
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

async function readRecentMessages(chatId: string): Promise<{
  messages: PromptMessage[]
  originalMessages: PromptMessage[]
  latestSource: SourceRevision | null
  latestMessageId: string | null
  totalRead: number
}> {
  const useLean = (spindle.host.capabilities['chat-lean-messages-v1'] ?? 0) >= 1
  const rawList = useLean
    ? await spindle.chat.getMessages(chatId, {
        tail: MESSAGE_TAIL,
        light: true,
        includeExtra: false,
        ownMetadataOnly: true,
      })
    : await spindle.chat.getMessages(chatId)

  const slice = Array.isArray(rawList) ? rawList.slice(-MESSAGE_TAIL) : []
  const visible = slice.filter(
    (m) => m && !m.hidden && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
  )

  const messages: PromptMessage[] = []
  const originalMessages: PromptMessage[] = []
  let latestSource: SourceRevision | null = null
  let latestMessageId: string | null = null

  for (const msg of visible) {
    originalMessages.push({ role: msg.role, content: msg.content })
    const cleaned = prepareMessageText(msg.content)
    if (cleaned) messages.push({ role: msg.role, content: cleaned })
    if (typeof msg.id === 'string' && msg.id) {
      latestMessageId = msg.id
      latestSource = { id: msg.id, role: msg.role, swipe_id: Number.isInteger(msg.swipe_id) ? msg.swipe_id : 0, content: msg.content }
    }
  }

  return { messages, originalMessages, latestSource, latestMessageId, totalRead: visible.length }
}

function archiveLayerIfChanged(record: StoredChatRecord, nextState: AtlasState): Record<Scale, MapLayer[]> {
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

function extractResponseContent(result: unknown): string {
  if (typeof result === 'string') return result
  if (!result || typeof result !== 'object') return ''
  const obj = result as Record<string, unknown>
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
  let myEpoch = rt.epoch
  let controller: AbortController | null = null
  let fallbackState: AtlasState | null = rt.record?.state ?? null
  let runId = `run_${Date.now()}`

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

    if (!await spindle.chats.get(rt.chatId, rt.userId)) throw new Error('Chat is unavailable for this user.')
    const { messages, originalMessages, latestSource, latestMessageId, totalRead } = await readRecentMessages(rt.chatId)
    if (!messages.length || !latestSource || latestSource.role !== 'assistant') {
      emitStatus(rt.userId, rt.chatId, 'error', 'No current assistant reply to simulate yet.', record.state, effectiveConfig, origin, record.archives, record.internalState)
      return
    }
    if (expected && latestSource.id !== expected.messageId) throw new Error('Reply changed before simulation started. Previous state kept.')
    if (trigger === 'auto' && expected && record.processedGenerationId === expected.generationId) return
    if (trigger === 'auto' && record.sourceRevision && sameSourceRevision(record.sourceRevision, latestSource) && !record.state.stale) return
    if (record.state.stale) {
      if (trigger === 'auto' || mode !== 'rebuild') {
        emitStatus(rt.userId, rt.chatId, 'stale', 'Chat history diverged. Use Rebuild to re-simulate from the current transcript; previous state is kept until the new snapshot is verified.', record.state, effectiveConfig, origin, record.archives, record.internalState)
        return
      }
      // Manual rebuild re-reads the current transcript and writes a new snapshot
      // only after the source is verified unchanged at commit time.
    }
    let seedState = record.internalState
    if (!seedState) {
      const migrated = migrateLastInternalState(originalMessages)
      seedState = Object.keys(migrated.sections).length || migrated.ledger ? migrated : blankInternalState()
    }

    cancelRuntime(rt)
    myEpoch = rt.epoch
    controller = new AbortController()
    rt.controller = controller
    rt.busy = true
    const activeController = controller
    rt.timer = setTimeout(() => activeController.abort(), ANALYSIS_TIMEOUT_MS)

    runId = (spindle.host.capabilities['uuid-v1'] ?? 0) >= 1 ? await spindle.uuid.v7() : `run_${Date.now()}`
    spindle.log.info(`LumiAtlas: starting ${mode} (${runId}) on chat ${rt.chatId} via ${chosen.name} (${chosen.model})`)

    emitStatus(
      rt.userId,
      rt.chatId,
      'updating',
      mode === 'rebuild'
        ? `Rebuilding 3-layer Atlas with ${chosen.name}…`
        : `Charting map update with ${chosen.name}…`,
      record.state,
      effectiveConfig,
      origin,
      record.archives,
    )

    const userPrompt = buildUnifiedPrompt(messages, record.state, seedState)
    const effectiveModel = chosen.model.trim()
    const genParams: Record<string, unknown> = { temperature: 0.2, max_tokens: 4800 }
    if (effectiveModel) genParams.model = effectiveModel
    const genRequest = {
      type: 'raw' as const,
      connection_id: chosen.id,
      ...(chosen.provider ? { provider: chosen.provider } : {}),
      ...(effectiveModel ? { model: effectiveModel } : {}),
      userId: rt.userId,
      messages: [
        { role: 'system' as const, content: UNIFIED_SYSTEM_PROMPT },
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
      emitStream(rt.userId, rt.chatId, 'thinking', '', 0, '', origin)
      for await (const chunk of spindle.generate.rawStream(genRequest)) {
        if (controller.signal.aborted || myEpoch !== rt.epoch) return
        if (chunk.type === 'reasoning') {
          reasoningAcc += chunk.token
        } else if (chunk.type === 'token') {
          contentAcc += chunk.token
        } else if (chunk.type === 'done') {
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
      if (!content && contentAcc) content = contentAcc
    } else {
      const rawResult = await spindle.generate.raw(genRequest)
      if (controller.signal.aborted || myEpoch !== rt.epoch) return
      content = extractResponseContent(rawResult)
    }

    if (controller.signal.aborted || myEpoch !== rt.epoch) return

    if (!content.trim()) {
      throw new Error(`${chosen.name} returned an empty response.`)
    }

    const parsed = extractUnifiedDelta(content)
    const nextInternalState = applyStateDelta(seedState, parsed.statePatch)
    const patchedAtlas = applyMapDelta(record.state, parsed.mapPatch)
    const nextState: AtlasState = {
      ...patchedAtlas,
      updatedAt: new Date().toISOString(),
      analyzedMessageId: latestMessageId,
      analyzedMessageCount: totalRead,
      stale: false,
      staleReason: '',
    }
    const nextRecord: StoredChatRecord = {
      ...record,
      state: nextState,
      internalState: nextInternalState,
      sourceRevision: latestSource,
      processedGenerationId: expected?.generationId,
      archives: archiveLayerIfChanged(record, nextState),
    }

    if (controller.signal.aborted || myEpoch !== rt.epoch) return
    const latest = await readRecentMessages(rt.chatId)
    if (!latest.latestSource || !sameSourceRevision(latestSource, latest.latestSource)) {
      await markStale(rt, 'Chat reply changed during simulation. Previous state kept.', origin)
        emitStatus(rt.userId, rt.chatId, 'stale', 'Chat reply changed during simulation. Use Rebuild to re-simulate; previous state kept.', record.state, effectiveConfig, origin, record.archives, record.internalState)
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
      `Atlas updated (${counts}).`,
      nextState,
      effectiveConfig,
      origin,
      nextRecord.archives,
      nextRecord.internalState,
    )
  } catch (err) {
    if (controller && myEpoch !== rt.epoch) return
    const isAbort = Boolean(controller?.signal.aborted) || (err instanceof Error && err.name === 'AbortError')
    const detail = isAbort
      ? 'Atlas update was cancelled or timed out. Previous map kept.'
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
  const next: StoredChatRecord = {
    ...record,
    state: {
      ...record.state,
      stale: true,
      staleReason: reason,
    },
  }
  await saveChatRecord(rt, next)
  emitStatus(rt.userId, rt.chatId, 'stale', reason, next.state, undefined, origin)
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
      if (row.backgroundSwipe === true || typeof row.generationId !== 'string' || !row.generationId) return
      cancelRuntime(rt)
      rt.generation = { id: row.generationId, sessionId: eventOrigin(payload)?.sessionId, start: row }
      if (typeof row.generationType === 'string' && ['swipe', 'regenerate', 'continue'].includes(row.generationType)) {
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
      void enqueue(rt, () =>
        runAnalysis(rt, 'update', 'auto', active.sessionId ? { sessionId: active.sessionId } : undefined,
          { messageId: decision.messageId!, generationId: active.id }),
      )
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
      return prepareSimulationContext(messages, record.internalState)
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

for (const ev of ['MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'SWIPE_EDITED'] as const) {
  spindle.on(ev, (payload, userId) => {
    const rt = eventRuntime(payload, userId)
    if (!rt) return
    cancelRuntime(rt)
    void enqueue(rt, () =>
      markStale(rt, 'Chat history changed (edit, delete, or swipe). Use Rebuild to re-simulate from the current transcript.', eventOrigin(payload)),
    )
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
        ? 'Charting map update…'
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
        const nextRecord: StoredChatRecord = { ...record, config: nextConfig }
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
