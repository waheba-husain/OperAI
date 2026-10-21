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

import { useState, useEffect, useRef } from 'react'
import type { UseChatDataReturn } from '../../hooks/useChatData.ts'
import type { UseVoiceReturn } from '../../hooks/useVoice.ts'
import type { ChatInputMode } from '../../types/chat.ts'
import type { PageId } from '../../types/navigation.ts'
import { ChatMessageList } from './ChatMessageList.tsx'
import { ChatInputBar } from './ChatInputBar.tsx'
import './ChatPanel.css'

import {
  processAssistantSpeechPlayback,
  type AssistantSpeechPlaybackOptions
} from './assistantSpeechPlayback.ts'

export { processAssistantSpeechPlayback }
export type { AssistantSpeechPlaybackOptions }

export interface ChatPanelProps {
  readonly chatData: UseChatDataReturn
  readonly voice?: UseVoiceReturn
  readonly onClose?: () => void
  readonly title?: string
  readonly subtitle?: string
  readonly className?: string
  readonly isMuted?: boolean
  readonly onToggleMute?: () => void
  readonly onNavigate?: (pageId: PageId) => void
}

export function ChatPanel({
  chatData,
  voice,
  onClose,
  title = 'OperAI Assistant',
  subtitle,
  className = '',
  isMuted: propIsMuted,
  onToggleMute: propOnToggleMute,
  onNavigate
}: ChatPanelProps) {
  const [internalMuted, setInternalMuted] = useState(false)
  const isMuted = propIsMuted ?? internalMuted

  const lastSpokenTranscriptRef = useRef<string>('')

  // Track message IDs known at mount time so historical messages are NEVER spoken
  const initialMessageIdsRef = useRef<Set<string> | null>(null)
  if (initialMessageIdsRef.current === null) {
    initialMessageIdsRef.current = new Set(chatData.messages.map((m) => m.id))
  }

  // Track all processed message IDs across rerenders to prevent duplicate speech
  const processedMessageIdsRef = useRef<Set<string>>(new Set())

  const transcript = voice?.transcript
  const { applyVoiceTranscript } = chatData

  // Keep voiceRef synchronized with latest voice instance across renders to prevent stale closures
  const voiceRef = useRef(voice)
  useEffect(() => {
    voiceRef.current = voice
  })

  // Stop speech synthesis when ChatPanel actually unmounts (never on voice reference changes)
  useEffect(() => {
    return () => {
      if (voiceRef.current?.isSpeaking) {
        voiceRef.current.stopSpeaking()
      }
    }
  }, [])

  // Process assistant speech playback when new messages arrive
  useEffect(() => {
    if (!voice?.speak) return

    processAssistantSpeechPlayback({
      messages: chatData.messages,
      mode: chatData.mode,
      isMuted,
      isSynthesisSupported: voice.isSynthesisSupported,
      initialMessageIds: initialMessageIdsRef.current ?? new Set(),
      processedMessageIds: processedMessageIdsRef.current,
      speak: voice.speak
    })
  }, [chatData.messages, chatData.mode, isMuted, voice])

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

  const handleToggleMute = () => {
    const nextMuted = !isMuted
    if (nextMuted && voice?.isSpeaking) {
      voice.stopSpeaking()
    }
    if (propOnToggleMute) {
      propOnToggleMute()
    } else {
      setInternalMuted(nextMuted)
    }
  }

  const handleStartListening = () => {
    if (!voice) return
    if (voice.isSpeaking) {
      voice.stopSpeaking()
    }
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
    if (voice?.isSpeaking) {
      voice.stopSpeaking()
    }
    const nextMode = chatData.mode === 'live' ? 'demo' : 'live'
    chatData.setMode(nextMode)
  }

  const handleClearConversation = () => {
    chatData.clearConversation()
    voice?.resetTranscript()
    if (voice?.isSpeaking) {
      voice.stopSpeaking()
    }
    initialMessageIdsRef.current = new Set()
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

          {/* Audio Mute / Unmute Toggle */}
          <button
            type="button"
            className={`chat-panel__icon-button ${isMuted ? 'chat-panel__icon-button--muted' : ''}`}
            onClick={handleToggleMute}
            title={isMuted ? 'Unmute assistant speech' : 'Mute assistant speech'}
            aria-label={isMuted ? 'Unmute assistant speech' : 'Mute assistant speech'}
            aria-pressed={isMuted}
          >
            {isMuted ? (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
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
          onNavigate={onNavigate}
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
