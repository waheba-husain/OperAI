/* ============================================================
   frontend/src/components/chat/ChatPanel.tsx
   OperAI / Cloud Kitchen Rescue — Conversational Assistant Panel

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.16 (POST /api/agent/chat)
   - docs/System_Architecture.md §2 (Frontend Voice Layer)
   - AGENTS.md (Rules 1, 2, 4, 8, 9)

   SAFETY INVARIANTS:
   1. Clean presentation container coordinating message history, draft entry,
      and voice controls.
   2. Explicit mode toggle between Live and Simulated Demo modes.
   3. NEVER auto-approves or approves actions via voice or chat.
   4. Speech recognition populates the editable draft; never auto-submits.
   ============================================================ */

import { useEffect, useRef } from 'react'
import type { UseChatDataReturn } from '../../hooks/useChatData.ts'
import type { UseVoiceReturn } from '../../hooks/useVoice.ts'
import type { ChatInputMode } from '../../types/chat.ts'
import { ChatMessageList } from './ChatMessageList.tsx'
import { ChatInputBar } from './ChatInputBar.tsx'
import './ChatPanel.css'

export interface ChatPanelProps {
  readonly chatData: UseChatDataReturn
  readonly voice?: UseVoiceReturn
  readonly onClose?: () => void
  readonly title?: string
  readonly subtitle?: string
  readonly className?: string
}

export function ChatPanel({
  chatData,
  voice,
  onClose,
  title = 'OperAI Assistant',
  subtitle,
  className = ''
}: ChatPanelProps) {
  const lastSpokenTranscriptRef = useRef<string>('')

  const transcript = voice?.transcript
  const { applyVoiceTranscript } = chatData

  // Synchronize incoming speech recognition transcript to user draft buffer
  useEffect(() => {
    if (!transcript) return

    if (transcript !== lastSpokenTranscriptRef.current) {
      lastSpokenTranscriptRef.current = transcript
      applyVoiceTranscript(transcript, 'replace')
    }
  }, [transcript, applyVoiceTranscript])

  // Reset tracking when transcript is cleared
  useEffect(() => {
    if (!transcript) {
      lastSpokenTranscriptRef.current = ''
    }
  }, [transcript])

  const handleStartListening = () => {
    if (!voice) return
    voice.resetTranscript()
    voice.startListening()
  }

  const handleStopListening = () => {
    if (!voice) return
    voice.stopListening()
  }

  const handleSendMessage = (options?: { inputMode?: ChatInputMode }) => {
    if (voice?.isListening) {
      voice.stopListening()
    }
    chatData.sendMessage(options)
    voice?.resetTranscript()
  }

  const handleToggleMode = () => {
    const nextMode = chatData.mode === 'live' ? 'demo' : 'live'
    chatData.setMode(nextMode)
  }

  const handleClearConversation = () => {
    chatData.clearConversation()
    voice?.resetTranscript()
  }

  const isDemo = chatData.mode === 'demo'

  return (
    <div
      className={`chat-panel ${className}`.trim()}
      role="region"
      aria-label="OperAI Kitchen Assistant"
    >
      {/* Panel Header */}
      <header className="chat-panel__header">
        <div className="chat-panel__title-group">
          <div className="chat-panel__logo-badge" aria-hidden="true">
            AI
          </div>
          <div>
            <h2 className="chat-panel__title">{title}</h2>
            <div className="chat-panel__subtitle">
              {subtitle ||
                (isDemo ? 'Offline Simulated Demonstration' : 'Real-Time Kitchen Operations')}
            </div>
          </div>
        </div>

        <div className="chat-panel__controls">
          {/* Mode Switcher Toggle */}
          <button
            type="button"
            className="chat-panel__mode-toggle"
            onClick={handleToggleMode}
            title={isDemo ? 'Switch to Live API Mode' : 'Switch to Simulated Demo Mode'}
            aria-label={`Current mode: ${isDemo ? 'Demo' : 'Live'}. Click to toggle.`}
          >
            <span
              className={`chat-panel__mode-indicator ${
                isDemo ? 'chat-panel__mode-indicator--demo' : 'chat-panel__mode-indicator--live'
              }`}
              aria-hidden="true"
            />
            <span>{isDemo ? 'Demo Mode' : 'Live'}</span>
          </button>

          {/* Clear / Reset Conversation */}
          <button
            type="button"
            className="chat-panel__icon-button"
            onClick={handleClearConversation}
            title={isDemo ? 'Reset demo conversation' : 'Clear conversation history'}
            aria-label="Clear conversation history"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>

          {/* Close Panel Button */}
          {onClose && (
            <button
              type="button"
              className="chat-panel__icon-button"
              onClick={onClose}
              title="Close chat assistant"
              aria-label="Close assistant"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Message Stream Body */}
      <div className="chat-panel__body">
        <ChatMessageList
          messages={chatData.messages}
          isLoading={chatData.isLoading}
          errorMessage={chatData.errorMessage}
          onRetry={() => chatData.sendMessage()}
          onClearError={() => chatData.clearError()}
          onSelectPrompt={(prompt) => chatData.applySuggestedPrompt(prompt)}
          isDemoMode={isDemo}
        />
      </div>

      {/* Input Bar & Voice Controls */}
      <ChatInputBar
        draft={chatData.draft}
        onDraftChange={(text) => chatData.setDraft(text)}
        onSend={handleSendMessage}
        isLoading={chatData.isLoading}
        draftInputMode={chatData.draftInputMode}
        voiceState={voice?.voiceState}
        isListening={voice?.isListening}
        isRecognitionSupported={voice?.isRecognitionSupported}
        voiceError={voice?.error}
        voiceErrorReason={voice?.errorReason}
        onStartListening={handleStartListening}
        onStopListening={handleStopListening}
      />
    </div>
  )
}
