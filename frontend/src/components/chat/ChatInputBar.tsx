/* ============================================================
   frontend/src/components/chat/ChatInputBar.tsx
   OperAI / Cloud Kitchen Rescue — Conversational Input & Voice Controls

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.16 (POST /api/agent/chat: 1-500 chars, voice or text)
   - docs/System_Architecture.md §2 (Frontend Voice Layer)
   - AGENTS.md (Rule 2: read/propose only; no auto-approval)

   SAFETY & UX INVARIANTS:
   1. 500-character maximum per Rest_API_Spec.md §3.16 with live counter.
   2. Keyboard navigation: Enter submits, Shift+Enter inserts newline.
   3. Explicit microphone activation only; NEVER auto-listens or auto-submits.
   4. Preserves draft on submission failure.
   5. Zero duplicate submission mechanisms; calls existing onSend handler exclusively.
   ============================================================ */

import { useRef, type KeyboardEvent, type ChangeEvent } from 'react'
import type { ChatInputMode, VoiceErrorReason, VoiceInputState } from '../../types/chat.ts'
import { MAX_CHAT_MESSAGE_LENGTH } from '../../hooks/useChatData.ts'
import './ChatInputBar.css'

export interface ChatInputBarProps {
  readonly draft: string
  readonly onDraftChange: (text: string) => void
  readonly onSend: (options?: { inputMode?: ChatInputMode }) => void
  readonly isLoading?: boolean
  readonly draftInputMode?: ChatInputMode

  // Voice integration props from useVoice hook
  readonly voiceState?: VoiceInputState
  readonly isListening?: boolean
  readonly isRecognitionSupported?: boolean
  readonly voiceError?: string | null
  readonly voiceErrorReason?: VoiceErrorReason | null
  readonly onStartListening?: () => void
  readonly onStopListening?: () => void

  readonly placeholder?: string
  readonly className?: string
}

export function ChatInputBar({
  draft,
  onDraftChange,
  onSend,
  isLoading = false,
  draftInputMode = 'text',
  voiceState = 'idle',
  isListening = false,
  isRecognitionSupported = true,
  voiceError = null,
  onStartListening,
  onStopListening,
  placeholder = 'Type a message or click mic to speak... (Press Enter to send)',
  className = ''
}: ChatInputBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const charCount = draft.length
  const isOverLimit = charCount > MAX_CHAT_MESSAGE_LENGTH
  const isEmpty = draft.trim().length === 0
  const canSubmit = !isLoading && !isEmpty && !isOverLimit

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSubmit) {
        onSend({ inputMode: draftInputMode })
      }
    }
  }

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onDraftChange(e.target.value)
  }

  const handleToggleVoice = () => {
    if (isListening) {
      onStopListening?.()
    } else {
      onStartListening?.()
    }
  }

  const handleSendClick = () => {
    if (canSubmit) {
      onSend({ inputMode: draftInputMode })
    }
  }

  return (
    <div
      className={`chat-input-bar ${className}`.trim()}
      role="form"
      aria-label="Message composition"
      data-voice-state={voiceState}
    >
      {/* Active Voice Listening Banner */}
      {isListening && (
        <div
          className="chat-input-bar__voice-status chat-input-bar__voice-status--listening"
          role="status"
          aria-live="assertive"
        >
          <div style={{ display: 'flex', alignContent: 'center', alignItems: 'center' }}>
            <span className="chat-input-bar__voice-pulse" aria-hidden="true" />
            <span>Listening... Speak clearly into your microphone. Review transcript below before sending.</span>
          </div>
          <button
            type="button"
            className="chat-message-list__error-button"
            onClick={onStopListening}
            aria-label="Stop listening"
          >
            Done
          </button>
        </div>
      )}

      {/* Voice Error Banner */}
      {!isListening && voiceError && (
        <div
          className="chat-input-bar__voice-status chat-input-bar__voice-status--error"
          role="alert"
        >
          <span>{voiceError}</span>
        </div>
      )}

      <div className="chat-input-bar__main-row">
        {/* Voice Toggle Button */}
        <button
          type="button"
          className={`chat-input-bar__mic-button ${
            isListening ? 'chat-input-bar__mic-button--active' : ''
          }`}
          onClick={handleToggleVoice}
          disabled={!isRecognitionSupported || isLoading}
          title={
            !isRecognitionSupported
              ? 'Speech recognition is not supported in this browser'
              : isListening
              ? 'Stop recording voice'
              : 'Record voice input (review before sending)'
          }
          aria-label={
            isListening ? 'Stop recording voice' : 'Start microphone for voice input'
          }
          aria-pressed={isListening}
        >
          {isListening ? (
            /* Stop / Active Mic Icon */
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            /* Mic Icon */
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>

        {/* Textarea Input */}
        <div className="chat-input-bar__textarea-wrapper">
          <textarea
            ref={textareaRef}
            className={`chat-input-bar__textarea ${
              isOverLimit ? 'chat-input-bar__textarea--over-limit' : ''
            }`}
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isLoading}
            rows={1}
            maxLength={MAX_CHAT_MESSAGE_LENGTH + 50} // Soft overflow so user sees counter turn red without truncation
            aria-label="Message draft"
            aria-invalid={isOverLimit}
          />
        </div>

        {/* Send Button */}
        <button
          type="button"
          className="chat-input-bar__send-button"
          onClick={handleSendClick}
          disabled={!canSubmit}
          aria-label="Send message"
        >
          <span>Send</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>

      {/* Footer Info & Character Counter */}
      <div className="chat-input-bar__footer">
        <span className="chat-input-bar__hint">
          {draftInputMode === 'voice'
            ? 'Voice transcript review • Edit or press Send'
            : 'Enter to send • Shift+Enter for new line'}
        </span>
        <span
          className={`chat-input-bar__counter ${
            charCount > MAX_CHAT_MESSAGE_LENGTH
              ? 'chat-input-bar__counter--danger'
              : charCount > 450
              ? 'chat-input-bar__counter--warning'
              : ''
          }`}
          aria-live="polite"
        >
          {charCount} / {MAX_CHAT_MESSAGE_LENGTH}
        </span>
      </div>
    </div>
  )
}
