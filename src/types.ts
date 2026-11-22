export type Scale = 'local' | 'region' | 'world'

export type TileKind =
  | 'room'
  | 'hallway'
  | 'street'
  | 'shop'
  | 'landmark'
  | 'settlement'
  | 'district'
  | 'region'
  | 'kingdom'
  | 'mountain'
  | 'water'
  | 'forest'
  | 'desert'
  | 'marsh'
  | 'ruin'
  | 'exit'
  | 'other'

export type TileStatus =
  | 'current'
  | 'visited'
  | 'known'
  | 'rumored'
  | 'locked'
  | 'unexplored'

export interface ConnectionOption {
  id: string
  name: string
  model: string
  provider: string
}

export interface Pin {
  id: string
  name: string
  /** Tile-local normalized X in [0..1] */
  x: number
  /** Tile-local normalized Y in [0..1] */
  y: number
  note?: string
  color?: string
  isPlayer?: boolean
}

export interface Road {
  from: string
  to: string
  kind: 'road' | 'path' | 'door' | 'stairs' | 'transit' | 'sea_route'
  label?: string
}

export interface Tile {
  id: string
  name: string
  kind: TileKind
  status: TileStatus
  x: number
  y: number
  w: number
  h: number
  floor: number
  sizeLabel: string
  color?: string
  summary: string
  features: string[]
  pins: Pin[]
  connections: string[]
}

export interface MapLayer {
  id: string
  name: string
  scale: Scale
  currentTileId: string | null
  activeFloor: number
  tiles: Tile[]
  roads: Road[]
}

export interface AtlasState {
  version: 1
  chatId: string
  updatedAt: string
  analyzedMessageId: string | null
  analyzedMessageCount: number
  stale: boolean
  staleReason: string
  currentLocation: string
  maps: Record<Scale, MapLayer>
  notes: string[]
}

export interface ChatConfig {
  enabled: boolean
  autoUpdate: boolean
}

export interface UserConfig {
  connectionId: string | null
}

export interface EffectiveConfig {
  enabled: boolean
  autoUpdate: boolean
  connectionId: string | null
}

export interface StoredChatRecord {
  schema: 1
  config: ChatConfig
  state: AtlasState
  archives: Record<Scale, MapLayer[]>
}

export type BackendToFrontendMessage =
  | {
      type: 'init'
      requestId: string | null
      activeChatId: string | null
      config: EffectiveConfig
      connections: ConnectionOption[]
      state: AtlasState | null
      busy: boolean
      statusMessage: string
      error: string | null
    }
  | {
      type: 'status'
      chatId: string | null
      status: 'idle' | 'updating' | 'ready' | 'stale' | 'error'
      message: string
      state?: AtlasState | null
      config?: EffectiveConfig
    }

export type FrontendToBackendMessage =
  | { type: 'init'; requestId?: string | null; chatId?: string | null }
  | { type: 'set_connection'; connectionId: string | null }
  | { type: 'set_chat_config'; chatId: string; enabled?: boolean; autoUpdate?: boolean }
  | { type: 'analyze'; chatId: string; mode: 'update' | 'rebuild' }
  | { type: 'cancel'; chatId: string }
