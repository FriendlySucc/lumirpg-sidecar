import { renderStateForPrompt, type InternalState } from './internal-state.js'
import { offloadPrompt } from './prompt-offload.js'
import type { InterceptorResultDTO, LlmMessageDTO } from 'lumiverse-spindle-types'

/** Only activate when the full preset is provably compatible. */
export function prepareSimulationContext(messages: LlmMessageDTO[], state: InternalState): LlmMessageDTO[] {
  const snapshot = renderStateForPrompt(state)
  if (!snapshot) return messages
  const result = offloadPrompt(messages, snapshot)
  return result.compatible ? result.messages : messages
}

/** Interceptor-ready wrapper that also returns Prompt Breakdown attribution. */
export function prepareSimulationInterceptorResult(
  messages: LlmMessageDTO[],
  state: InternalState,
): { output: LlmMessageDTO[] | InterceptorResultDTO; compatible: boolean; reason: string } {
  const snapshot = renderStateForPrompt(state)
  if (!snapshot) return { output: messages, compatible: false, reason: 'no-state' }
  const result = offloadPrompt(messages, snapshot)
  if (!result.compatible) return { output: messages, compatible: false, reason: result.reason }
  return {
    output: {
      messages: result.messages,
      breakdown: result.breakdown,
    },
    compatible: true,
    reason: result.reason,
  }
}
