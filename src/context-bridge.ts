import { renderStateForPrompt, type InternalState } from './internal-state.js'
import { offloadPrompt } from './prompt-offload.js'
import type { LlmMessageDTO } from 'lumiverse-spindle-types'

/** Only activate when the full preset is provably compatible. */
export function prepareSimulationContext(messages: LlmMessageDTO[], state: InternalState): LlmMessageDTO[] {
  const snapshot = renderStateForPrompt(state)
  if (!snapshot) return messages
  const result = offloadPrompt(messages, snapshot)
  return result.compatible ? result.messages : messages
}
