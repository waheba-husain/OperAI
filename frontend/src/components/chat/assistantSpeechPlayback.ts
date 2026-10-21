/* ============================================================
   frontend/src/components/chat/assistantSpeechPlayback.ts
   OperAI / Cloud Kitchen Rescue — Assistant Speech Playback Pure Logic
   ============================================================ */

import type { ChatMessage } from '../../types/chat.ts'
import type { ChatMode } from '../../hooks/useChatData.ts'

export interface AssistantSpeechPlaybackOptions {
  readonly messages: readonly ChatMessage[]
  readonly mode: ChatMode
  readonly isMuted: boolean
  readonly isSynthesisSupported?: boolean
  readonly initialMessageIds: ReadonlySet<string>
  readonly processedMessageIds: Set<string>
  readonly speak: (text: string) => void
}

/**
 * Pure evaluation function for assistant response speech playback.
 * Enforces Feature 7 speech playback invariants:
 * - Spoken strictly once in Live mode for assistant responses
 * - Never speaks user messages, loading indicators, or errors
 * - Never speaks historical messages present on mount
 * - Never re-speaks on rerenders or reprocessing
 * - Respects mute state; unmuting does not replay old responses
 * - Demo mode never triggers speech
 * - Graceful degradation when speech synthesis is unsupported
 */
export function processAssistantSpeechPlayback({
  messages,
  mode,
  isMuted,
  isSynthesisSupported = true,
  initialMessageIds,
  processedMessageIds,
  speak
}: AssistantSpeechPlaybackOptions): boolean {
  if (!isSynthesisSupported) {
    return false
  }

  if (messages.length === 0) {
    return false
  }

  const latestMessage = messages[messages.length - 1]
  if (!latestMessage) {
    return false
  }

  // 1. Only assistant messages can trigger speech (Req 2)
  if (latestMessage.sender !== 'assistant') {
    return false
  }

  // 2. Only Live mode: do not speak simulated demo responses (Req 1, Req 6)
  if (latestMessage.isSimulated || mode !== 'live') {
    return false
  }

  // 3. Historical message check: do not speak messages that existed on mount (Req 2)
  if (initialMessageIds.has(latestMessage.id)) {
    return false
  }

  // 4. Duplicate prevention: do not speak if already processed (Req 3)
  if (processedMessageIds.has(latestMessage.id)) {
    return false
  }

  // Mark as processed immediately so rerenders or subsequent unmuting will never re-speak
  processedMessageIds.add(latestMessage.id)

  // 5. Mute check: do not speak if muted (Req 5)
  if (isMuted) {
    return false
  }

  // 6. Speak the assistant reply text
  const textToSpeak = latestMessage.text?.trim()
  if (textToSpeak) {
    try {
      speak(textToSpeak)
      return true
    } catch {
      return false
    }
  }

  return false
}
