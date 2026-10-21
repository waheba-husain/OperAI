/* ============================================================
   frontend/src/components/chat/ChatMessageList.tsx
   OperAI / Cloud Kitchen Rescue — Conversational Message List

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.16 (POST /api/agent/chat)
   - AGENTS.md (Rule 2: read/propose only; Rule 9: honest data labeling)
   ============================================================ */

import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../../types/chat.ts'
import type { PageId } from '../../types/navigation.ts'
import { SUGGESTED_CHAT_PROMPTS } from '../../hooks/useChatData.ts'
import { ChatProposalCard } from './ChatProposalCard.tsx'
import './ChatMessageList.css'

export interface ChatMessageListProps {
  readonly messages: readonly ChatMessage[]
  readonly isLoading?: boolean
  readonly errorMessage?: string | null
  readonly onRetry?: () => void
  readonly onClearError?: () => void
  readonly onSelectPrompt?: (prompt: string) => void
  readonly isDemoMode?: boolean
  readonly className?: string
  readonly onNavigate?: (pageId: PageId) => void
}

function formatMessageTime(isoString?: string): string {
  if (!isoString) return ''
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function ChatMessageList({
  messages,
  isLoading = false,
  errorMessage = null,
  onRetry,
  onClearError,
  onSelectPrompt,
  isDemoMode = false,
  className = '',
  onNavigate
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll to bottom on new messages or loading updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isLoading, errorMessage])

  const isEmpty = messages.length === 0

  return (
    <div
      className={`chat-message-list ${className}`.trim()}
      role="log"
      aria-live="polite"
      aria-label="Conversation History"
    >
      {isEmpty && (
        <div className="chat-message-list__empty">
          <svg
            className="chat-message-list__empty-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 2a5 5 0 0 1 5 5v1a4 4 0 0 1 4 4c0 1.6-.9 3-2.3 3.6L18 22H6l-.7-6.4C3.9 15 3 13.6 3 12a4 4 0 0 1 4-4V7a5 5 0 0 1 5-5z" />
          </svg>
          <div className="chat-message-list__empty-title">OperAI Kitchen Co-Pilot</div>
          <div className="chat-message-list__empty-subtitle">
            {isDemoMode
              ? 'Operating in Simulated Demo Mode with offline kitchen scenarios.'
              : 'Ask questions, review morning risk briefs, or report ingredient shortages.'}
          </div>

          <div className="chat-message-list__prompts-heading">Suggested Inquiries</div>
          <div className="chat-message-list__prompts-grid" role="group" aria-label="Suggested Prompts">
            {SUGGESTED_CHAT_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="chat-message-list__prompt-button"
                onClick={() => onSelectPrompt?.(prompt)}
                aria-label={`Ask: ${prompt}`}
              >
                <span>{prompt}</span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.map((msg) => {
        const isUser = msg.sender === 'user'
        const isError = msg.status === 'error'
        const isSending = msg.status === 'sending'
        const timeFormatted = formatMessageTime(msg.timestamp)

        return (
          <div
            key={msg.id}
            className={`chat-message-item ${
              isUser ? 'chat-message-item--user' : 'chat-message-item--assistant'
            } ${isError ? 'chat-message-item--error' : ''}`}
          >
            <div className="chat-message-item__header">
              {isUser ? (
                <>
                  {msg.isSimulated && (
                    <span className="chat-message-item__simulated-badge" title="Simulated demo message">
                      Simulated
                    </span>
                  )}
                  {msg.inputMode && (
                    <span className="chat-message-item__mode-tag">
                      {msg.inputMode === 'voice' ? '🎤 Voice' : '⌨ Text'}
                    </span>
                  )}
                  {timeFormatted && <span className="chat-message-item__time">{timeFormatted}</span>}
                  <span className="chat-message-item__sender">You</span>
                </>
              ) : (
                <>
                  <span className="chat-message-item__sender">OperAI Assistant</span>
                  {timeFormatted && <span className="chat-message-item__time">{timeFormatted}</span>}
                  {msg.isSimulated && (
                    <span className="chat-message-item__simulated-badge" title="Simulated demo response">
                      Simulated
                    </span>
                  )}
                </>
              )}
            </div>

            <div className="chat-message-item__bubble">
              <div className="chat-message-item__text">{msg.text}</div>

              {/* Render proposal card if message contains candidate options */}
              {!isUser && (msg.requiresConfirmation || msg.actionGroupId || msg.confirmPhrases?.length) && (
                <ChatProposalCard
                  actionGroupId={msg.actionGroupId}
                  optionActionIds={msg.optionActionIds}
                  confirmPhrases={msg.confirmPhrases}
                  requiresConfirmation={msg.requiresConfirmation}
                  isSimulated={msg.isSimulated}
                  onNavigate={onNavigate}
                />
              )}

              {/* Badges for Assistant tool and intent if present */}
              {!isUser && (msg.intent || msg.toolUsed) && (
                <div className="chat-message-item__badges">
                  {msg.intent && (
                    <span className="chat-message-item__badge">Intent: {msg.intent}</span>
                  )}
                  {msg.toolUsed && (
                    <span className="chat-message-item__badge">Tool: {msg.toolUsed}</span>
                  )}
                </div>
              )}

              {/* In-flight status for user messages */}
              {isSending && (
                <div className="chat-message-item__badges">
                  <span className="chat-message-item__badge">Sending...</span>
                </div>
              )}
            </div>

            {/* Error tag for failed user message transmission */}
            {isError && (
              <div className="chat-message-item__status-error" role="alert">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{msg.errorMessage || 'Failed to send message.'}</span>
              </div>
            )}
          </div>
        )
      })}

      {/* In-Flight Assistant Analyzing Indicator */}
      {isLoading && (
        <div className="chat-message-list__loading-card" role="status" aria-label="OperAI is analyzing">
          <div className="chat-message-list__dots" aria-hidden="true">
            <div className="chat-message-list__dot" />
            <div className="chat-message-list__dot" />
            <div className="chat-message-list__dot" />
          </div>
          <span>OperAI is analyzing kitchen operations...</span>
        </div>
      )}

      {/* Inline API Error Alert Banner */}
      {errorMessage && (
        <div className="chat-message-list__error-banner" role="alert">
          <div className="chat-message-list__error-content">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{errorMessage}</span>
          </div>
          <div className="chat-message-list__error-actions">
            {onRetry && (
              <button type="button" className="chat-message-list__error-button" onClick={onRetry}>
                Retry
              </button>
            )}
            {onClearError && (
              <button
                type="button"
                className="chat-message-list__error-button"
                onClick={onClearError}
                aria-label="Dismiss error"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      <div ref={bottomRef} tabIndex={-1} aria-hidden="true" />
    </div>
  )
}
