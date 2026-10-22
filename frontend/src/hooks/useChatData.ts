/* ============================================================
   frontend/src/hooks/useChatData.ts
   OperAI / Cloud Kitchen Rescue — Conversational Chat Data Hook

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.16 (POST /api/agent/chat)
   - docs/System_Architecture.md §2 (Frontend Voice & Chat Layer)
   - AGENTS.md (Rules 1, 2, 4, 8, 9)

   SAFETY & INTEGRITY INVARIANTS:
   1. AI read/propose only (AGENTS.md Rule 2):
      The chat assistant ONLY queries briefs and proposes recovery options.
      It CANNOT approve, reject, or execute any mutation. Approvals occur
      strictly through POST /api/actions/{id}/approve.
   2. Explicit submission only:
      Speech recognition transcripts are accepted solely as draft updates.
      Speech recognition NEVER submits automatically.
   3. Honest data labeling (AGENTS.md Rule 9):
      Demo mode messages and proposals are visibly flagged `isSimulated: true`.
      Demo mode never issues live API requests.
   4. Isolation & no silent fallback:
      Live API errors (401, 422, 502, 500) surface cleanly to the user.
      Live mode NEVER silently switches to demo mode upon encountering an error.
      Live and simulated message threads remain strictly isolated.
   5. No fabricated metadata:
      Action group IDs and option IDs are extracted if and only if present
      in documented response payloads; missing optional metadata is never fabricated.
   6. Draft preservation:
      If a network or API request fails, the user's draft is preserved in
      the input buffer so they can review, edit, and retry without losing input.
   7. In-flight protection:
      Duplicate submissions are prevented while a request is in flight.
   ============================================================ */

import { useState, useEffect, useCallback } from 'react'
import type { ApiClient } from '../api/client.ts'
import { approveAction, chatAgent } from '../api/endpoints.ts'
import { formatActionErrorMessage } from '../api/adapters/actionAdapter.ts'
import { ApiError, ConfigurationError, NetworkError } from '../api/errors.ts'
import type {
  ActionApproveRequestDTO,
  ActionApproveResponseDTO,
  AgentChatResponseDTO,
  ChatHistoryMessageDTO
} from '../types/dto.ts'
import type {
  ChatMessage,
  ChatConfirmationPrompt,
  ChatInputMode
} from '../types/chat.ts'
import {
  DEMO_CHAT_CONVERSATION,
  DEMO_CHAT_RESPONSES
} from '../pages/chat/demoChatData.ts'

export type ChatMode = 'live' | 'demo'

const WORD_TO_NUMBER: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
}

/**
 * Parses an explicit confirmation command (e.g. "confirm option 2").
 * Returns the requested option number and raw matched text, or null if not an explicit confirmation.
 * CRITICAL SAFETY (AGENTS.md Rule 2):
 * Does NOT match ambiguous messages or messages that merely mention options.
 */
export function parseConfirmationPhrase(
  text: string,
  confirmPhrases?: readonly string[]
): { optionNumber: number; rawText: string } | null {
  if (typeof text !== 'string') return null
  const cleaned = text.trim()
  if (!cleaned) return null

  // Strip optional trailing punctuation (. ! ?)
  const normalized = cleaned.replace(/[.!?]+$/, '').trim()

  // Match: "(yes,) (please) confirm/approve option <N> (please)"
  const match = normalized.match(
    /^(?:yes,?\s+)?(?:please\s+)?(?:confirm|approve)\s+option\s+(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+please)?$/i
  )
  if (match) {
    const numPart = match[1].toLowerCase()
    let optionNumber: number
    if (/^\d+$/.test(numPart)) {
      optionNumber = parseInt(numPart, 10)
    } else {
      optionNumber = WORD_TO_NUMBER[numPart] ?? -1
    }

    if (Number.isSafeInteger(optionNumber) && optionNumber >= 0) {
      return { optionNumber, rawText: cleaned }
    }
  }

  // Also check if text matches one of the active confirmPhrases
  if (confirmPhrases && confirmPhrases.length > 0) {
    const lower = normalized.toLowerCase()
    for (const phrase of confirmPhrases) {
      const phraseNorm = phrase.trim().replace(/[.!?]+$/, '').toLowerCase()
      if (phraseNorm === lower) {
        const phraseMatch = phrase.match(/option\s+(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)/i)
        if (phraseMatch) {
          const numPart = phraseMatch[1].toLowerCase()
          const optionNumber = /^\d+$/.test(numPart) ? parseInt(numPart, 10) : (WORD_TO_NUMBER[numPart] ?? -1)
          if (optionNumber >= 0) {
            return { optionNumber, rawText: cleaned }
          }
        }
      }
    }
  }

  return null
}

export const MAX_CHAT_MESSAGE_LENGTH = 500

export const SUGGESTED_CHAT_PROMPTS: readonly string[] = [
  'What is my morning risk brief?',
  'We are out of paneer',
  'What orders are at risk today?',
  'Analyze pricing for butter chicken'
]

let messageIdSequence = 0

/**
 * Generates unique, non-colliding message identifiers with informative prefixes.
 */
export function generateChatMessageId(prefix = 'msg'): string {
  messageIdSequence += 1
  return `${prefix}-${Date.now()}-${messageIdSequence}`
}

/**
 * Safely extracts actionGroupId and optionActionIds from documented data payload.
 * NEVER fabricates identifiers or confirmation metadata if omitted or invalid.
 */
export function extractActionMetadata(data?: Record<string, unknown> | null): {
  readonly actionGroupId?: string
  readonly optionActionIds?: readonly string[]
} {
  if (!data || typeof data !== 'object') {
    return {}
  }

  const result: { actionGroupId?: string; optionActionIds?: string[] } = {}

  if (typeof data['group_id'] === 'string' && data['group_id'].trim().length > 0) {
    result.actionGroupId = data['group_id']
  }

  if (Array.isArray(data['option_action_ids'])) {
    const validIds = data['option_action_ids'].filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0
    )
    if (validIds.length > 0) {
      result.optionActionIds = validIds
    }
  }

  return result
}

/**
 * Determines whether the candidate proposal card should be rendered for a message.
 * Strictly returns a boolean to prevent numeric 0 from being rendered as text in React JSX.
 */
export function shouldRenderProposalCard(msg: ChatMessage): boolean {
  if (msg.sender === 'user') return false
  const hasValidGroupId = typeof msg.actionGroupId === 'string' && msg.actionGroupId.trim().length > 0
  const hasConfirmPhrases = Array.isArray(msg.confirmPhrases) && msg.confirmPhrases.length > 0
  return Boolean(msg.requiresConfirmation || hasValidGroupId || hasConfirmPhrases)
}


/* ── View Models & Options ──────────────────────────────────── */

export interface ChatConversationSnapshot {
  readonly mode: ChatMode
  readonly isLive: boolean
  readonly isDemo: boolean
  readonly messages: readonly ChatMessage[]
  readonly draft: string
  readonly draftInputMode: ChatInputMode
  readonly charCount: number
  readonly maxChars: number
  readonly isOverLimit: boolean
  readonly isEmpty: boolean
  readonly canSubmit: boolean
  readonly isLoading: boolean
  readonly error: ApiError | ConfigurationError | NetworkError | Error | null
  readonly errorMessage: string | null
  readonly activeConfirmation: ChatConfirmationPrompt | null
}

export interface SendMessageOptions {
  readonly message?: string
  readonly inputMode?: ChatInputMode
}

export interface UseChatDataOptions {
  readonly client?: ApiClient
  readonly initialMode?: ChatMode
  readonly initialMessages?: readonly ChatMessage[]
  readonly initialDraft?: string
  readonly onMessageSent?: (message: ChatMessage) => void
  readonly onAssistantReply?: (message: ChatMessage) => void
  readonly onActionApproved?: (response: ActionApproveResponseDTO) => void
  readonly onError?: (error: Error) => void
}

export interface ChatConversationControllerOptions extends UseChatDataOptions {
  readonly onStateChange?: (snapshot: ChatConversationSnapshot) => void
}

export interface UseChatDataReturn extends ChatConversationSnapshot {
  readonly setDraft: (text: string) => void
  readonly appendDraft: (text: string) => void
  readonly applyVoiceTranscript: (transcript: string, mode?: 'replace' | 'append') => void
  readonly clearDraft: () => void
  readonly clearError: () => void
  readonly clearConversation: () => void
  readonly setMode: (mode: ChatMode) => void
  readonly sendMessage: (options?: SendMessageOptions) => Promise<boolean>
  readonly applySuggestedPrompt: (prompt: string) => void
}

/* ── Headless Conversation State Machine ─────────────────────── */

/**
 * Headless controller managing conversation history, draft input, live/demo modes,
 * speech recognition draft updates, and in-flight API dispatch.
 * Fully testable in Node 24 native test runner without DOM or React renderer dependencies.
 */
export class ChatConversationController {
  private client?: ApiClient
  private mode: ChatMode
  private liveMessages: ChatMessage[]
  private demoMessages: ChatMessage[]
  private draft: string
  private draftInputMode: ChatInputMode
  private isLoading: boolean
  private error: ApiError | ConfigurationError | NetworkError | Error | null
  private errorMessage: string | null
  private activeConfirmation: ChatConfirmationPrompt | null

  private liveEpoch = 0
  private abortController: AbortController | null = null
  private isDestroyed = false

  private onStateChange?: (snapshot: ChatConversationSnapshot) => void
  private onMessageSent?: (message: ChatMessage) => void
  private onAssistantReply?: (message: ChatMessage) => void
  private onActionApproved?: (response: ActionApproveResponseDTO) => void
  private onError?: (error: Error) => void

  constructor(options?: ChatConversationControllerOptions) {
    this.client = options?.client
    this.mode = options?.initialMode ?? 'live'
    this.liveMessages = options?.initialMessages && this.mode === 'live'
      ? [...options.initialMessages]
      : []
    // Initialize demo messages with simulated demo conversation (or custom initial messages if provided in demo mode)
    this.demoMessages = options?.initialMessages && this.mode === 'demo'
      ? [...options.initialMessages]
      : [...DEMO_CHAT_CONVERSATION]
    this.draft = options?.initialDraft ?? ''
    this.draftInputMode = 'text'
    this.isLoading = false
    this.error = null
    this.errorMessage = null
    this.activeConfirmation = null

    this.onStateChange = options?.onStateChange
    this.onMessageSent = options?.onMessageSent
    this.onAssistantReply = options?.onAssistantReply
    this.onActionApproved = options?.onActionApproved
    this.onError = options?.onError

    // Sync initial active confirmation if initial messages end in a confirmation prompt
    this.syncActiveConfirmation()
  }

  updateClient(client?: ApiClient): void {
    this.client = client
  }

  updateOptions(options?: UseChatDataOptions): void {
    if (!options) return
    this.client = options.client
    this.onMessageSent = options.onMessageSent
    this.onAssistantReply = options.onAssistantReply
    this.onActionApproved = options.onActionApproved
    this.onError = options.onError
  }

  activate(): void {
    this.isDestroyed = false
  }

  setOnStateChange(handler?: (snapshot: ChatConversationSnapshot) => void): void {
    this.onStateChange = handler
    if (handler) {
      this.isDestroyed = false
    }
  }

  getSnapshot(): ChatConversationSnapshot {
    const isLive = this.mode === 'live'
    const isDemo = this.mode === 'demo'
    const messages = isLive ? this.liveMessages : this.demoMessages
    const charCount = this.draft.length
    const maxChars = MAX_CHAT_MESSAGE_LENGTH
    const isOverLimit = charCount > maxChars
    const isEmpty = this.draft.trim().length === 0
    const canSubmit = !this.isLoading && !isEmpty && !isOverLimit

    return {
      mode: this.mode,
      isLive,
      isDemo,
      messages: Object.freeze([...messages]),
      draft: this.draft,
      draftInputMode: this.draftInputMode,
      charCount,
      maxChars,
      isOverLimit,
      isEmpty,
      canSubmit,
      isLoading: this.isLoading,
      error: this.error,
      errorMessage: this.errorMessage,
      activeConfirmation: this.activeConfirmation
    }
  }

  private emitState(): void {
    if (this.isDestroyed) return
    this.onStateChange?.(this.getSnapshot())
  }

  private syncActiveConfirmation(): void {
    const currentMessages = this.mode === 'live' ? this.liveMessages : this.demoMessages
    const lastAssistant = [...currentMessages].reverse().find((m) => m.sender === 'assistant')
    if (lastAssistant?.requiresConfirmation) {
      this.activeConfirmation = {
        requiresConfirmation: true,
        confirmPhrases: lastAssistant.confirmPhrases ? [...lastAssistant.confirmPhrases] : [],
        ...(lastAssistant.actionGroupId ? { actionGroupId: lastAssistant.actionGroupId } : {}),
        ...(lastAssistant.optionActionIds ? { optionActionIds: [...lastAssistant.optionActionIds] } : {})
      }
    } else {
      this.activeConfirmation = null
    }
  }

  setDraft(text: string): void {
    if (this.isDestroyed) return
    this.draft = text
    this.draftInputMode = 'text'
    // Clear validation error if user adjusted draft
    if (this.error && this.error instanceof ApiError && this.error.status === 422) {
      this.error = null
      this.errorMessage = null
    }
    this.emitState()
  }

  appendDraft(text: string): void {
    if (this.isDestroyed || typeof text !== 'string' || text.length === 0) return
    if (this.draft.length > 0 && !this.draft.endsWith(' ')) {
      this.draft = `${this.draft} ${text}`
    } else {
      this.draft = `${this.draft}${text}`
    }
    this.emitState()
  }

  /**
   * Applies recognized voice transcript to the user's editable draft buffer.
   * CRITICAL SAFETY: NEVER automatically submits the transcript.
   * The user retains full review and editing control before clicking Send.
   */
  applyVoiceTranscript(transcript: string, mode: 'replace' | 'append' = 'replace'): void {
    if (this.isDestroyed || typeof transcript !== 'string') return
    if (mode === 'append' && this.draft.length > 0) {
      const sep = this.draft.endsWith(' ') ? '' : ' '
      this.draft = `${this.draft}${sep}${transcript}`
    } else {
      this.draft = transcript
    }
    this.draftInputMode = 'voice'
    if (this.error && this.error instanceof ApiError && this.error.status === 422) {
      this.error = null
      this.errorMessage = null
    }
    this.emitState()
  }

  applySuggestedPrompt(prompt: string): void {
    if (this.isDestroyed) return
    this.setDraft(prompt)
  }

  clearDraft(): void {
    if (this.isDestroyed) return
    this.draft = ''
    this.draftInputMode = 'text'
    this.emitState()
  }

  clearError(): void {
    if (this.isDestroyed) return
    this.error = null
    this.errorMessage = null
    this.emitState()
  }

  clearConversation(): void {
    if (this.isDestroyed) return
    if (this.mode === 'live') {
      this.liveMessages = []
      this.liveEpoch += 1
    } else {
      this.demoMessages = [...DEMO_CHAT_CONVERSATION]
    }
    this.activeConfirmation = null
    this.error = null
    this.errorMessage = null
    this.syncActiveConfirmation()
    this.emitState()
  }

  /**
   * Explicitly sets mode between 'live' and 'demo'.
   * Threads are kept strictly isolated and never merged.
   */
  setMode(mode: ChatMode): void {
    if (this.isDestroyed || this.mode === mode) return
    this.mode = mode
    this.error = null
    this.errorMessage = null
    this.syncActiveConfirmation()
    this.emitState()
  }

  /**
   * Submits a user message explicitly.
   * Returns true if processing completed successfully; false otherwise.
   */
  async sendMessage(options?: SendMessageOptions): Promise<boolean> {
    if (this.isDestroyed) return false

    // 1. Prevent duplicate submissions while request in flight
    if (this.isLoading) {
      return false
    }

    const messageText = options?.message !== undefined ? options.message : this.draft
    const inputMode: ChatInputMode = options?.inputMode ?? this.draftInputMode

    // 2. Validate message length and empty/whitespace per Rest_API_Spec.md §3.16
    if (typeof messageText !== 'string' || messageText.length === 0 || messageText.trim().length === 0) {
      const validationError = new ApiError(422, {
        code: 'VALIDATION_ERROR',
        message: 'Message is required and must not be empty.',
        details: { field: 'message', length: typeof messageText === 'string' ? messageText.length : 0 }
      })
      this.error = validationError
      this.errorMessage = validationError.message
      this.emitState()
      return false
    }

    if (messageText.length > MAX_CHAT_MESSAGE_LENGTH) {
      const validationError = new ApiError(422, {
        code: 'VALIDATION_ERROR',
        message: `Message exceeds maximum allowed length of ${MAX_CHAT_MESSAGE_LENGTH} characters (received ${messageText.length}).`,
        details: { field: 'message', length: messageText.length }
      })
      this.error = validationError
      this.errorMessage = validationError.message
      this.emitState()
      return false
    }

    // 3. Explicit Recovery Option Confirmation Check
    // When user submits an explicit confirmation command (e.g. "confirm option 2"),
    // verify active confirmation proposal and resolve action ID to call approveAction.
    const confirmationMatch = parseConfirmationPhrase(messageText, this.activeConfirmation?.confirmPhrases)
    if (confirmationMatch) {
      if (this.mode === 'demo') {
        return this.handleDemoConfirmation(messageText, inputMode, confirmationMatch.optionNumber, options)
      }
      return this.handleLiveConfirmation(messageText, inputMode, confirmationMatch.optionNumber, options)
    }

    // 4. Demo Mode Handling (Offline deterministic flow, strictly no live network calls)
    if (this.mode === 'demo') {
      return this.handleDemoSubmission(messageText, inputMode, options)
    }

    // 5. Live Mode Handling
    return this.handleLiveSubmission(messageText, inputMode, options)
  }

  private handleDemoConfirmation(
    messageText: string,
    inputMode: ChatInputMode,
    optionNumber: number,
    options?: SendMessageOptions
  ): boolean {
    const userMsg: ChatMessage = {
      id: generateChatMessageId('demo-user'),
      sender: 'user',
      text: messageText,
      timestamp: new Date().toISOString(),
      inputMode,
      isSimulated: true,
      status: 'sent'
    }
    this.demoMessages.push(userMsg)

    // Check whether valid active confirmation proposal exists
    if (!this.activeConfirmation || !this.activeConfirmation.requiresConfirmation) {
      const err = new ApiError(409, {
        code: 'NO_ACTIVE_PROPOSAL',
        message: 'No active recovery proposal to confirm.'
      })
      this.error = err
      this.errorMessage = err.message
      const assistantMsg: ChatMessage = {
        id: generateChatMessageId('demo-assistant'),
        sender: 'assistant',
        text: 'There is no active recovery proposal to confirm. Please request recovery options first.',
        timestamp: new Date().toISOString(),
        intent: 'clarification',
        toolUsed: null,
        requiresConfirmation: false,
        confirmPhrases: [],
        isSimulated: true,
        status: 'sent'
      }
      this.demoMessages.push(assistantMsg)
      this.emitState()
      this.onMessageSent?.(userMsg)
      this.onAssistantReply?.(assistantMsg)
      return false
    }

    const optionActionIds = this.activeConfirmation.optionActionIds
    const optionIndex = optionNumber - 1

    if (!optionActionIds || optionActionIds.length === 0) {
      const err = new ApiError(422, {
        code: 'MISSING_ACTION_ID',
        message: 'No action IDs found for the active recovery proposal.'
      })
      this.error = err
      this.errorMessage = err.message
      this.emitState()
      this.onMessageSent?.(userMsg)
      return false
    }

    if (optionIndex < 0 || optionIndex >= optionActionIds.length) {
      const err = new ApiError(422, {
        code: 'OPTION_MISMATCH',
        message: `Option ${optionNumber} is not a valid option. Available options: 1 to ${optionActionIds.length}.`
      })
      this.error = err
      this.errorMessage = err.message
      const assistantMsg: ChatMessage = {
        id: generateChatMessageId('demo-assistant'),
        sender: 'assistant',
        text: `Option ${optionNumber} is not valid for this proposal. Please select from Option 1 to Option ${optionActionIds.length}.`,
        timestamp: new Date().toISOString(),
        intent: 'clarification',
        toolUsed: null,
        requiresConfirmation: false,
        confirmPhrases: [],
        isSimulated: true,
        status: 'sent'
      }
      this.demoMessages.push(assistantMsg)
      this.emitState()
      this.onMessageSent?.(userMsg)
      this.onAssistantReply?.(assistantMsg)
      return false
    }

    const actionId = optionActionIds[optionIndex]
    if (!actionId || typeof actionId !== 'string' || actionId.trim().length === 0) {
      const err = new ApiError(422, {
        code: 'MISSING_ACTION_ID',
        message: `Action ID for Option ${optionNumber} is missing or invalid.`
      })
      this.error = err
      this.errorMessage = err.message
      const assistantMsg: ChatMessage = {
        id: generateChatMessageId('demo-assistant'),
        sender: 'assistant',
        text: `Action ID for Option ${optionNumber} is missing or invalid.`,
        timestamp: new Date().toISOString(),
        intent: 'clarification',
        toolUsed: null,
        requiresConfirmation: false,
        confirmPhrases: [],
        isSimulated: true,
        status: 'sent'
      }
      this.demoMessages.push(assistantMsg)
      this.emitState()
      this.onMessageSent?.(userMsg)
      this.onAssistantReply?.(assistantMsg)
      return false
    }

    // Demo Mode: MUST NOT execute real approval request per Requirement 12
    const assistantMsg: ChatMessage = {
      id: generateChatMessageId('demo-assistant'),
      sender: 'assistant',
      text: `Option ${optionNumber} confirmation received (Demo Mode). Action approval is simulated and disabled in Demo Mode — connect a live backend with an API key to approve and apply changes to the operational plan.`,
      timestamp: new Date().toISOString(),
      intent: 'approval_simulated',
      toolUsed: null,
      requiresConfirmation: false,
      confirmPhrases: [],
      isSimulated: true,
      status: 'sent'
    }
    this.demoMessages.push(assistantMsg)
    this.activeConfirmation = null

    // Clear draft on success ONLY if user has not typed newer input while in flight
    const submittedDraft = options?.message === undefined ? this.draft : null
    if (submittedDraft !== null && this.draft === submittedDraft) {
      this.draft = ''
      this.draftInputMode = 'text'
    }

    this.error = null
    this.errorMessage = null
    this.emitState()

    this.onMessageSent?.(userMsg)
    this.onAssistantReply?.(assistantMsg)
    return true
  }

  private async handleLiveConfirmation(
    messageText: string,
    inputMode: ChatInputMode,
    optionNumber: number,
    options?: SendMessageOptions
  ): Promise<boolean> {
    const submissionEpoch = this.liveEpoch
    const submittedDraft = options?.message === undefined ? this.draft : null

    // 1. Check whether valid active confirmation proposal exists
    if (!this.activeConfirmation || !this.activeConfirmation.requiresConfirmation) {
      const userMsg: ChatMessage = {
        id: generateChatMessageId('live-user'),
        sender: 'user',
        text: messageText,
        timestamp: new Date().toISOString(),
        inputMode,
        isSimulated: false,
        status: 'error',
        errorMessage: 'No active recovery proposal to confirm.'
      }
      this.liveMessages.push(userMsg)

      const err = new ApiError(409, {
        code: 'NO_ACTIVE_PROPOSAL',
        message: 'No active recovery proposal to confirm.'
      })
      this.error = err
      this.errorMessage = err.message
      this.emitState()
      this.onMessageSent?.(userMsg)
      this.onError?.(err)
      return false
    }

    // 2. Resolve option number to action ID using active proposal metadata
    const optionActionIds = this.activeConfirmation.optionActionIds
    const optionIndex = optionNumber - 1

    if (!optionActionIds || optionActionIds.length === 0) {
      const userMsg: ChatMessage = {
        id: generateChatMessageId('live-user'),
        sender: 'user',
        text: messageText,
        timestamp: new Date().toISOString(),
        inputMode,
        isSimulated: false,
        status: 'error',
        errorMessage: 'No action IDs found for the active recovery proposal.'
      }
      this.liveMessages.push(userMsg)

      const err = new ApiError(422, {
        code: 'MISSING_ACTION_ID',
        message: 'No action IDs found for the active recovery proposal.'
      })
      this.error = err
      this.errorMessage = err.message
      this.emitState()
      this.onMessageSent?.(userMsg)
      this.onError?.(err)
      return false
    }

    if (optionIndex < 0 || optionIndex >= optionActionIds.length) {
      const userMsg: ChatMessage = {
        id: generateChatMessageId('live-user'),
        sender: 'user',
        text: messageText,
        timestamp: new Date().toISOString(),
        inputMode,
        isSimulated: false,
        status: 'error',
        errorMessage: `Option ${optionNumber} is not a valid option. Available options: 1 to ${optionActionIds.length}.`
      }
      this.liveMessages.push(userMsg)

      const err = new ApiError(422, {
        code: 'OPTION_MISMATCH',
        message: `Option ${optionNumber} is not a valid option. Available options: 1 to ${optionActionIds.length}.`
      })
      this.error = err
      this.errorMessage = err.message
      this.emitState()
      this.onMessageSent?.(userMsg)
      this.onError?.(err)
      return false
    }

    const actionId = optionActionIds[optionIndex]
    if (!actionId || typeof actionId !== 'string' || actionId.trim().length === 0) {
      const userMsg: ChatMessage = {
        id: generateChatMessageId('live-user'),
        sender: 'user',
        text: messageText,
        timestamp: new Date().toISOString(),
        inputMode,
        isSimulated: false,
        status: 'error',
        errorMessage: `Action ID for Option ${optionNumber} is missing or invalid.`
      }
      this.liveMessages.push(userMsg)

      const err = new ApiError(422, {
        code: 'MISSING_ACTION_ID',
        message: `Action ID for Option ${optionNumber} is missing or invalid.`
      })
      this.error = err
      this.errorMessage = err.message
      this.emitState()
      this.onMessageSent?.(userMsg)
      this.onError?.(err)
      return false
    }

    // 3. User message valid -> start approval dispatch
    const userMsg: ChatMessage = {
      id: generateChatMessageId('live-user'),
      sender: 'user',
      text: messageText,
      timestamp: new Date().toISOString(),
      inputMode,
      isSimulated: false,
      status: 'sending'
    }

    this.liveMessages.push(userMsg)
    this.isLoading = true
    this.error = null
    this.errorMessage = null
    this.emitState()
    this.onMessageSent?.(userMsg)

    this.abortController = new AbortController()

    try {
      const approvePayload: ActionApproveRequestDTO = {
        confirm_option_number: optionNumber,
        input_mode: inputMode === 'voice' ? 'voice' : 'click',
        transcript: messageText
      }

      const response = await approveAction(
        actionId,
        approvePayload,
        { client: this.client, signal: this.abortController.signal }
      )

      if (this.isDestroyed) return false

      if (this.liveEpoch !== submissionEpoch) {
        this.isLoading = false
        this.emitState()
        return false
      }

      // Mark user message as sent
      const userIndex = this.liveMessages.findIndex((m) => m.id === userMsg.id)
      if (userIndex !== -1) {
        this.liveMessages[userIndex] = { ...this.liveMessages[userIndex], status: 'sent' }
      }

      // Construct assistant response using actual API response
      const summaryText = response.changes?.summary
      const customerMsgCount = response.customer_messages?.length ?? 0
      const customerNote = customerMsgCount > 0 ? ` ${customerMsgCount} customer message(s) drafted.` : ''
      const replyText = summaryText
        ? `Option ${optionNumber} approved. ${summaryText}. Plan updated to version ${response.plan_version_after}.${customerNote}`
        : `Option ${optionNumber} approved. Plan updated to version ${response.plan_version_after}.${customerNote}`

      const assistantMsg: ChatMessage = {
        id: generateChatMessageId('live-assistant'),
        sender: 'assistant',
        text: replyText,
        timestamp: new Date().toISOString(),
        intent: 'approval_confirmed',
        toolUsed: 'approve_action',
        requiresConfirmation: false,
        confirmPhrases: [],
        isSimulated: false,
        status: 'sent'
      }

      this.liveMessages.push(assistantMsg)

      // Clear active confirmation once executed
      this.activeConfirmation = null

      if (submittedDraft !== null && this.draft === submittedDraft) {
        this.draft = ''
        this.draftInputMode = 'text'
      }

      this.isLoading = false
      this.error = null
      this.errorMessage = null
      this.emitState()

      this.onAssistantReply?.(assistantMsg)
      this.onActionApproved?.(response)
      return true
    } catch (err: unknown) {
      if (this.isDestroyed) return false

      if (this.liveEpoch !== submissionEpoch) {
        this.isLoading = false
        this.emitState()
        return false
      }

      const resolvedError =
        err instanceof ApiError || err instanceof ConfigurationError || err instanceof NetworkError
          ? err
          : new Error(err instanceof Error ? err.message : String(err))

      const formattedErrorMsg = formatActionErrorMessage(resolvedError)

      const userIndex = this.liveMessages.findIndex((m) => m.id === userMsg.id)
      if (userIndex !== -1) {
        this.liveMessages[userIndex] = {
          ...this.liveMessages[userIndex],
          status: 'error',
          errorMessage: formattedErrorMsg
        }
      }

      this.isLoading = false

      if (this.mode === 'live') {
        this.error = resolvedError
        this.errorMessage = formattedErrorMsg
      }

      // If action is expired or not pending (409), clear stale confirmation
      if (resolvedError instanceof ApiError && resolvedError.status === 409) {
        this.activeConfirmation = null
      }

      this.emitState()
      this.onError?.(resolvedError as Error)
      return false
    } finally {
      this.abortController = null
    }
  }

  private handleDemoSubmission(
    messageText: string,
    inputMode: ChatInputMode,
    options?: SendMessageOptions
  ): boolean {
    const userMsg: ChatMessage = {
      id: generateChatMessageId('demo-user'),
      sender: 'user',
      text: messageText,
      timestamp: new Date().toISOString(),
      inputMode,
      isSimulated: true,
      status: 'sent'
    }

    this.demoMessages.push(userMsg)

    // Select deterministic simulated response
    const lower = messageText.toLowerCase()
    let template: AgentChatResponseDTO = DEMO_CHAT_RESPONSES.clarifyingUnknown
    if (
      lower.includes('paneer') ||
      lower.includes('short') ||
      lower.includes('out of') ||
      lower.includes('substitut')
    ) {
      template = DEMO_CHAT_RESPONSES.recoveryProposal
    } else if (
      lower.includes('brief') ||
      lower.includes('risk') ||
      lower.includes('morning') ||
      lower.includes('status') ||
      lower.includes('order')
    ) {
      template = DEMO_CHAT_RESPONSES.informational
    }

    const { actionGroupId, optionActionIds } = extractActionMetadata(template.data)

    const assistantMsg: ChatMessage = {
      id: generateChatMessageId('demo-assistant'),
      sender: 'assistant',
      text: template.reply,
      timestamp: new Date().toISOString(),
      intent: template.intent,
      toolUsed: template.tool_used,
      requiresConfirmation: template.requires_confirmation,
      confirmPhrases: [...template.confirm_phrases],
      ...(actionGroupId ? { actionGroupId } : {}),
      ...(optionActionIds ? { optionActionIds } : {}),
      isSimulated: true,
      status: 'sent'
    }

    this.demoMessages.push(assistantMsg)

    if (template.requires_confirmation) {
      this.activeConfirmation = {
        requiresConfirmation: true,
        confirmPhrases: [...template.confirm_phrases],
        ...(actionGroupId ? { actionGroupId } : {}),
        ...(optionActionIds ? { optionActionIds } : {})
      }
    } else {
      this.activeConfirmation = null
    }

    // Clear draft on success ONLY if user has not typed newer input while in flight
    const submittedDraft = options?.message === undefined ? this.draft : null
    if (submittedDraft !== null && this.draft === submittedDraft) {
      this.draft = ''
      this.draftInputMode = 'text'
    }

    this.error = null
    this.errorMessage = null
    this.emitState()

    this.onMessageSent?.(userMsg)
    this.onAssistantReply?.(assistantMsg)
    return true
  }

  private async handleLiveSubmission(
    messageText: string,
    inputMode: ChatInputMode,
    options?: SendMessageOptions
  ): Promise<boolean> {
    const submissionEpoch = this.liveEpoch
    const submittedDraft = options?.message === undefined ? this.draft : null

    const userMsg: ChatMessage = {
      id: generateChatMessageId('live-user'),
      sender: 'user',
      text: messageText,
      timestamp: new Date().toISOString(),
      inputMode,
      isSimulated: false,
      status: 'sending'
    }

    // Append user message upon acceptance for processing
    this.liveMessages.push(userMsg)
    this.isLoading = true
    this.error = null
    this.errorMessage = null
    this.emitState()
    this.onMessageSent?.(userMsg)

    this.abortController = new AbortController()

    // Collect prior conversation turns in this live thread for multi-turn context
    const previousHistory: ChatHistoryMessageDTO[] = this.liveMessages
      .filter((m) => m.id !== userMsg.id && m.status !== 'error' && m.text.trim().length > 0)
      .slice(-10)
      .map((m) => ({
        role: m.sender === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.text
      }))

    try {
      const response = await chatAgent(
        {
          message: messageText,
          input_mode: inputMode,
          ...(previousHistory.length > 0 ? { history: previousHistory } : {})
        },
        { client: this.client, signal: this.abortController.signal }
      )

      if (this.isDestroyed) return false

      // 1. CLEARING DURING IN-FLIGHT REQUEST:
      // If user cleared the live conversation while this request was in flight,
      // the stale response must NOT repopulate the cleared conversation.
      if (this.liveEpoch !== submissionEpoch) {
        this.isLoading = false
        this.emitState()
        return false
      }

      // Mark user message sent
      const userIndex = this.liveMessages.findIndex((m) => m.id === userMsg.id)
      if (userIndex !== -1) {
        this.liveMessages[userIndex] = { ...this.liveMessages[userIndex], status: 'sent' }
      }

      // Extract metadata without fabrication
      const { actionGroupId, optionActionIds } = extractActionMetadata(response.data)

      const assistantMsg: ChatMessage = {
        id: generateChatMessageId('live-assistant'),
        sender: 'assistant',
        text: response.reply,
        timestamp: new Date().toISOString(),
        intent: response.intent,
        toolUsed: response.tool_used ?? null,
        requiresConfirmation: Boolean(response.requires_confirmation),
        confirmPhrases: Array.isArray(response.confirm_phrases) ? [...response.confirm_phrases] : [],
        ...(actionGroupId ? { actionGroupId } : {}),
        ...(optionActionIds ? { optionActionIds } : {}),
        isSimulated: false,
        status: 'sent'
      }

      // Append assistant message upon successful response to liveMessages
      this.liveMessages.push(assistantMsg)

      // 2. MODE SWITCH DURING IN-FLIGHT REQUEST:
      // If user switched to demo mode while request was in flight, response remains in liveMessages
      // but must NOT overwrite currently displayed demo confirmation state.
      if (this.mode === 'live') {
        if (response.requires_confirmation) {
          this.activeConfirmation = {
            requiresConfirmation: true,
            confirmPhrases: Array.isArray(response.confirm_phrases) ? [...response.confirm_phrases] : [],
            ...(actionGroupId ? { actionGroupId } : {}),
            ...(optionActionIds ? { optionActionIds } : {})
          }
        } else {
          this.activeConfirmation = null
        }
      }

      // 3. DRAFT PRESERVATION & NEWER INPUT:
      // Clear draft on success ONLY if user has not typed newer input after submission began.
      if (submittedDraft !== null && this.draft === submittedDraft) {
        this.draft = ''
        this.draftInputMode = 'text'
      }

      this.isLoading = false
      this.error = null
      this.errorMessage = null
      this.emitState()

      this.onAssistantReply?.(assistantMsg)
      return true
    } catch (err: unknown) {
      if (this.isDestroyed) return false

      // If user cleared live conversation while request was in flight, ignore stale error
      if (this.liveEpoch !== submissionEpoch) {
        this.isLoading = false
        this.emitState()
        return false
      }

      const resolvedError =
        err instanceof ApiError || err instanceof ConfigurationError || err instanceof NetworkError
          ? err
          : new Error(err instanceof Error ? err.message : String(err))

      // Mark user message as error in liveMessages
      const userIndex = this.liveMessages.findIndex((m) => m.id === userMsg.id)
      if (userIndex !== -1) {
        this.liveMessages[userIndex] = {
          ...this.liveMessages[userIndex],
          status: 'error',
          errorMessage: resolvedError.message
        }
      }

      this.isLoading = false

      // Do not overwrite demo error state if user switched to demo mode
      if (this.mode === 'live') {
        this.error = resolvedError
        this.errorMessage = resolvedError.message
      }

      // Preserves user draft on failure! (this.draft is untouched)
      this.emitState()
      this.onError?.(resolvedError as Error)
      return false
    } finally {
      this.abortController = null
    }
  }

  destroy(): void {
    this.isDestroyed = true
    this.liveEpoch += 1
    if (this.abortController) {
      try {
        this.abortController.abort()
      } catch {
        // Ignore
      }
      this.abortController = null
    }
  }
}

/* ── React Hook: useChatData ────────────────────────────────── */

/**
 * React hook exposing conversation thread, draft input, explicit message submission,
 * voice transcript review, and live/demo mode switching.
 */
export function useChatData(options?: UseChatDataOptions): UseChatDataReturn {
  const [controller] = useState(() => {
    return new ChatConversationController(options)
  })

  const [snapshot, setSnapshot] = useState<ChatConversationSnapshot>(() =>
    controller.getSnapshot()
  )

  useEffect(() => {
    controller.activate()
    return () => {
      controller.destroy()
    }
  }, [controller])

  useEffect(() => {
    controller.setOnStateChange(setSnapshot)
    controller.updateOptions(options)
  }, [controller, options])

  const setDraft = useCallback((text: string) => {
    controller.setDraft(text)
  }, [controller])

  const appendDraft = useCallback((text: string) => {
    controller.appendDraft(text)
  }, [controller])

  const applyVoiceTranscript = useCallback((transcript: string, mode?: 'replace' | 'append') => {
    controller.applyVoiceTranscript(transcript, mode)
  }, [controller])

  const clearDraft = useCallback(() => {
    controller.clearDraft()
  }, [controller])

  const clearError = useCallback(() => {
    controller.clearError()
  }, [controller])

  const clearConversation = useCallback(() => {
    controller.clearConversation()
  }, [controller])

  const setMode = useCallback((mode: ChatMode) => {
    controller.setMode(mode)
  }, [controller])

  const sendMessage = useCallback((sendOptions?: SendMessageOptions) => {
    return controller.sendMessage(sendOptions)
  }, [controller])

  const applySuggestedPrompt = useCallback((prompt: string) => {
    controller.applySuggestedPrompt(prompt)
  }, [controller])

  return {
    ...snapshot,
    setDraft,
    appendDraft,
    applyVoiceTranscript,
    clearDraft,
    clearError,
    clearConversation,
    setMode,
    sendMessage,
    applySuggestedPrompt
  }
}
