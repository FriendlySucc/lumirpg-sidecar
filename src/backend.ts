import {
  cleanText,
  emptyAtlasState,
  extractJsonObject,
  sanitizeProposal,
} from './geometry.js'
import { buildAtlasPrompt, SYSTEM_PROMPT, type PromptMessage } from './prompt.js'
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
const MAX_ARCHIVES = 5
const ANALYSIS_TIMEOUT_MS = 120_000
const MESSAGE_TAIL = 14

interface Origin {
  sessionId?: string
}

interface ActiveGeneration {
  id: string
  sessionId?: string
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
    config: { enabled: false, autoUpdate: true },
    state: emptyAtlasState(chatId),
    archives: { local: [], region: [], world: [] },
  }
}

async function readUserConfig(userId: string): Promise<UserConfig> {
  try {
    const raw = await spindle.userStorage.getJson<Partial<UserConfig>>(userConfigPath(), {
      userId,
      fallback: { connectionId: null },
    })
    const connectionId = typeof raw?.connectionId === 'string' && raw.connectionId.trim() ? raw.connectionId.trim() : null
    return { connectionId }
  } catch {
    return { connectionId: null }
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
          enabled: raw.config?.enabled === true,
          autoUpdate: raw.config?.autoUpdate !== false,
        },
        state: raw.state,
        archives: {
          local: Array.isArray(raw.archives?.local) ? raw.archives.local : [],
          region: Array.isArray(raw.archives?.region) ? raw.archives.region : [],
          world: Array.isArray(raw.archives?.world) ? raw.archives.world : [],
        },
      }
      rt.record = record
      return record
    }
  } catch (err) {
    spindle.log.warn(`providertlas: failed loading record for ${rt.chatId}: ${err instanceof Error ? err.message : String(err)}`)
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
): void {
  sendToUI(userId, { type: 'status', chatId, status, message, state, config }, origin)
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
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function readRecentMessages(chatId: string): Promise<{
  messages: PromptMessage[]
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
  let latestMessageId: string | null = null

  for (const msg of visible) {
    const cleaned = prepareMessageText(msg.content)
    if (!cleaned) continue
    messages.push({ role: msg.role, content: cleaned })
    if (typeof msg.id === 'string' && msg.id) latestMessageId = msg.id
  }

  return { messages, latestMessageId, totalRead: visible.length }
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
): Promise<void> {
  if (!spindle.permissions.has('generation')) {
    if (trigger === 'manual') {
      emitStatus(rt.userId, rt.chatId, 'error', 'Grant the "generation" permission in Extensions to analyze maps.', rt.record?.state ?? null, undefined, origin)
    }
    return
  }
  if (!spindle.permissions.has('chats')) {
    if (trigger === 'manual') {
      emitStatus(rt.userId, rt.chatId, 'error', 'Grant the "chats" permission in Extensions to read chat messages.', rt.record?.state ?? null, undefined, origin)
    }
    return
  }

  const userConfig = await readUserConfig(rt.userId)
  const record = await loadChatRecord(rt)

  if (trigger === 'auto' && (!record.config.enabled || !record.config.autoUpdate)) return

  if (!userConfig.connectionId) {
    if (trigger === 'manual') {
      emitStatus(rt.userId, rt.chatId, 'error', 'Pick a background connection (e.g. Terra) in Settings first.', record.state, { ...record.config, connectionId: null }, origin)
    }
    return
  }

  const connections = await listConnections(rt.userId)
  const chosen = connections.find((c) => c.id === userConfig.connectionId)
  if (!chosen) {
    if (trigger === 'manual') {
      emitStatus(rt.userId, rt.chatId, 'error', 'Selected connection is no longer available. Pick another in Settings.', record.state, { ...record.config, connectionId: userConfig.connectionId }, origin)
    }
    return
  }

  const { messages, latestMessageId, totalRead } = await readRecentMessages(rt.chatId)
  if (!messages.length) {
    if (trigger === 'manual') {
      emitStatus(rt.userId, rt.chatId, 'error', 'No visible chat messages to map yet.', record.state, undefined, origin)
    }
    return
  }

  if (trigger === 'auto' && latestMessageId && record.state.analyzedMessageId === latestMessageId && !record.state.stale) {
    return
  }

  cancelRuntime(rt)
  const myEpoch = rt.epoch
  const controller = new AbortController()
  rt.controller = controller
  rt.busy = true
  rt.timer = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS)

  const runId = (spindle.host.capabilities['uuid-v1'] ?? 0) >= 1 ? await spindle.uuid.v7() : `run_${Date.now()}`
  spindle.log.info(`providertlas: starting ${mode} (${runId}) on chat ${rt.chatId} via ${chosen.name} (${chosen.model})`)

  emitStatus(
    rt.userId,
    rt.chatId,
    'updating',
    mode === 'rebuild'
      ? `Rebuilding 3-layer Atlas with ${chosen.name}…`
      : `Charting map update with ${chosen.name}…`,
    record.state,
    { ...record.config, connectionId: userConfig.connectionId },
    origin,
  )

  try {
    const userPrompt = buildAtlasPrompt(messages, mode === 'rebuild' ? null : record.state, mode)
    const rawResult = await spindle.generate.raw({
      type: 'raw',
      connection_id: chosen.id,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      parameters: { temperature: 0.2, max_tokens: 4800 },
      reasoning: { source: 'off' },
      signal: controller.signal,
    })

    if (controller.signal.aborted || myEpoch !== rt.epoch) return

    const content = extractResponseContent(rawResult)
    if (!content.trim()) {
      throw new Error(`${chosen.name} returned an empty response.`)
    }

    const parsed = extractJsonObject(content)
    const nextState = sanitizeProposal(
      parsed,
      rt.chatId,
      latestMessageId,
      totalRead,
      mode === 'rebuild' ? undefined : record.state,
    )

    const nextRecord: StoredChatRecord = {
      schema: 1,
      config: record.config,
      state: nextState,
      archives: archiveLayerIfChanged(record, nextState),
    }

    if (controller.signal.aborted || myEpoch !== rt.epoch) return

    await saveChatRecord(rt, nextRecord)

    const counts = `${nextState.maps.local.tiles.length} local · ${nextState.maps.region.tiles.length} region · ${nextState.maps.world.tiles.length} world`
    emitStatus(
      rt.userId,
      rt.chatId,
      'ready',
      `Atlas updated (${counts}).`,
      nextState,
      { ...nextRecord.config, connectionId: userConfig.connectionId },
      origin,
    )
  } catch (err) {
    if (myEpoch !== rt.epoch) return
    const isAbort = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')
    const detail = isAbort
      ? 'Atlas update was cancelled or timed out. Previous map kept.'
      : `Atlas update failed: ${err instanceof Error ? err.message : String(err)}`
    spindle.log.warn(`providertlas (${runId}): ${detail}`)
    emitStatus(rt.userId, rt.chatId, 'error', detail, record.state, undefined, origin)
  } finally {
    if (rt.timer) {
      clearTimeout(rt.timer)
      rt.timer = undefined
    }
    if (rt.controller === controller) {
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
      rt.generation = { id: row.generationId, sessionId: eventOrigin(payload)?.sessionId }
    }),
  )

  generationUnsubs.push(
    spindle.on('GENERATION_ENDED', (payload, userId) => {
      const rt = eventRuntime(payload, userId)
      if (!rt) return
      const row = payload as unknown as Record<string, unknown>
      if (!rt.generation || rt.generation.id !== row.generationId) return
      const sessionId = rt.generation.sessionId
      rt.generation = undefined
      if (row.error) return
      void enqueue(rt, () =>
        runAnalysis(rt, 'update', 'auto', sessionId ? { sessionId } : undefined),
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

registerGenerationEvents()

spindle.permissions.onChanged(({ permission, granted }) => {
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
      markStale(rt, 'Chat history changed (edit, delete, or swipe). Click Update or Rebuild to sync.', eventOrigin(payload)),
    )
  })
}

spindle.on('CHAT_SWITCHED', (_payload, userId) => {
  if (!validUserId(userId)) return
  for (const rt of runtimes.values()) {
    if (rt.userId === userId) {
      rt.generation = undefined
    }
  }
})

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
            config: { enabled: false, autoUpdate: true, connectionId: userConfig.connectionId },
            connections,
            state: null,
            busy: false,
            statusMessage: 'Open a chat to view its Atlas.',
            error: null,
          },
          origin,
        )
        return
      }

      const rt = getRuntime(userId, activeChatId)
      const record = await loadChatRecord(rt)
      const effective: EffectiveConfig = {
        ...record.config,
        connectionId: userConfig.connectionId,
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
      await writeUserConfig(userId, { connectionId })
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
        },
        origin,
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
          { ...nextConfig, connectionId: userConfig.connectionId },
          origin,
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
    spindle.log.error(`providertlas message handler error: ${err instanceof Error ? err.message : String(err)}`)
    emitStatus(
      userId,
      await getActiveChatId(userId),
      'error',
      err instanceof Error ? err.message : 'Unexpected providertlas error.',
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

spindle.log.info('providertlas backend loaded')
