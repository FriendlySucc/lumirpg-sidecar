export interface GenerationStart {
  chatId?: unknown
  generationId?: unknown
  generationType?: unknown
  backgroundSwipe?: unknown
  extensionId?: unknown
}
export interface GenerationEnd {
  chatId?: unknown
  generationId?: unknown
  messageId?: unknown
  generationType?: unknown
  error?: unknown
}
export interface SourceRevision {
  id: string
  role: string
  swipe_id: number
  content: string
}

/** Ignore errors, background swipes, impersonation, and unrelated generations. */
export function assessGeneration(start: GenerationStart, end: GenerationEnd): {eligible: boolean; messageId?: string} {
  const type = end.generationType ?? start.generationType
  if (typeof start.chatId !== 'string' || !start.chatId || start.chatId !== end.chatId ||
      typeof start.generationId !== 'string' || !start.generationId || start.generationId !== end.generationId ||
      typeof end.messageId !== 'string' || !end.messageId || end.error || start.backgroundSwipe === true ||
      start.extensionId || (type !== undefined && type !== 'normal')) {
    return {eligible: false}
  }
  return {eligible: true, messageId: end.messageId}
}

/** Compare exact source text and active swipe; a changed message is not the same turn. */
export function sameSourceRevision(a: SourceRevision, b: SourceRevision): boolean {
  return Boolean(a.id && a.role === 'assistant' && a.id === b.id && b.role === 'assistant' &&
    Number.isInteger(a.swipe_id) && a.swipe_id === b.swipe_id &&
    typeof a.content === 'string' && a.content === b.content)
}
