/* ============================================================
   frontend/src/types/chat.ts
   OperAI / Cloud Kitchen Rescue — Chat & Voice View Models

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.16 (POST /api/agent/chat)
   - docs/System_Architecture.md §2 (Frontend Voice Layer)
   - AGENTS.md (Rules 1, 2, 8, 9: AI read/propose only, honesty in labeling)
   ============================================================ */

/** Who sent the chat message */
export type ChatSender = 'user' | 'assistant' | 'system'

/** Input modality for user input */
export type ChatInputMode = 'voice' | 'text'

/**
 * Recognized backend assistant intents per Rest_API_Spec.md §3.16 & features.md.
 * Tools are strictly read-or-propose: get_brief, propose_recovery, analyze_price, extract_order.
 */
export type ChatIntent =
  | 'report_shortage'
  | 'get_brief'
  | 'analyze_price'
  | 'extract_order'
  | 'unknown'
  | string

/**
 * State of the browser Web Speech voice interaction lifecycle.
 */
export type VoiceInputState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'unsupported'
  | 'error'

/**
 * Categorized voice recognition error causes.
 */
export type VoiceErrorReason =
  | 'permission_denied'
  | 'no_speech'
  | 'network'
  | 'not_supported'
  | 'aborted'
  | 'unknown'

/**
 * Presentation view model for an individual message bubble in the conversation.
 * Strictly decoupled from raw backend DTOs.
 */
export interface ChatMessage {
  readonly id: string
  readonly sender: ChatSender
  readonly text: string
  readonly timestamp: string // ISO 8601 or formatted time string
  readonly inputMode?: ChatInputMode
  readonly intent?: ChatIntent
  readonly toolUsed?: string | null
  readonly requiresConfirmation?: boolean
  readonly confirmPhrases?: readonly string[]
  readonly actionGroupId?: string
  readonly optionActionIds?: readonly string[]
  readonly isSimulated?: boolean
  readonly status?: 'sending' | 'sent' | 'error'
  readonly errorMessage?: string
}

/**
 * State representing a pending spoken or button confirmation for proposed options.
 * CRITICAL SAFETY (AGENTS.md Rule 2 & 4):
 * Chat only displays proposals and confirm phrases. Execution happens solely
 * via POST /api/actions/{id}/approve with the explicit option number.
 */
export interface ChatConfirmationPrompt {
  readonly requiresConfirmation: boolean
  readonly confirmPhrases: readonly string[]
  readonly actionGroupId?: string
  readonly optionActionIds?: readonly string[]
}

/**
 * Aggregated state for the active chat conversation view.
 */
export interface ChatConversationState {
  readonly messages: readonly ChatMessage[]
  readonly voiceState: VoiceInputState
  readonly activeConfirmation?: ChatConfirmationPrompt | null
  readonly isProcessing: boolean
  readonly error?: string | null
}
