/* ============================================================
   frontend/src/components/chat/ChatDrawer.tsx
   OperAI / Cloud Kitchen Rescue — Conversational Assistant Drawer

   SOURCE OF TRUTH:
   - docs/System_Architecture.md §2 (Frontend Voice & Chat Layer)
   - AGENTS.md (Rules 1, 2, 4, 8, 9)

   SAFETY & ACCESSIBILITY INVARIANTS:
   1. Slide-out drawer accessible via role="dialog" and aria-modal="true".
   2. Escape key dismisses the drawer and restores focus to trigger.
   3. Closing the drawer explicitly terminates active voice recognition & synthesis.
   4. Preserves conversation state and in-flight dispatches without resetting.
   ============================================================ */

import { useEffect, useRef, type MouseEvent, type RefObject } from 'react'
import type { UseChatDataReturn } from '../../hooks/useChatData.ts'
import type { UseVoiceReturn } from '../../hooks/useVoice.ts'
import type { PageId } from '../../types/navigation.ts'
import { ChatPanel } from './ChatPanel.tsx'
import './ChatDrawer.css'

export interface ChatDrawerProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly chatData: UseChatDataReturn
  readonly voice?: UseVoiceReturn
  readonly triggerRef?: RefObject<HTMLButtonElement | null>
  readonly isMuted?: boolean
  readonly onToggleMute?: () => void
  readonly onNavigate?: (pageId: PageId) => void
}

export function ChatDrawer({
  isOpen,
  onClose,
  chatData,
  voice,
  triggerRef,
  isMuted,
  onToggleMute,
  onNavigate
}: ChatDrawerProps) {
  const drawerRef = useRef<HTMLDivElement | null>(null)

  const voiceRef = useRef(voice)
  useEffect(() => {
    voiceRef.current = voice
  })

  // Stop voice recognition and speech synthesis if active when drawer closes
  useEffect(() => {
    if (!isOpen) {
      if (voiceRef.current?.isListening) {
        voiceRef.current.stopListening()
      }
      if (voiceRef.current?.isSpeaking) {
        voiceRef.current.stopSpeaking()
      }
    }
  }, [isOpen])

  // Stop voice recognition and speech synthesis when drawer unmounts
  useEffect(() => {
    return () => {
      if (voiceRef.current?.isListening) {
        voiceRef.current.stopListening()
      }
      if (voiceRef.current?.isSpeaking) {
        voiceRef.current.stopSpeaking()
      }
    }
  }, [])

  // Handle Escape key to dismiss drawer
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Focus management: focus drawer input on open, restore focus to trigger button on close
  useEffect(() => {
    if (isOpen) {
      const textarea = drawerRef.current?.querySelector('textarea') as HTMLElement | null
      const closeButton = drawerRef.current?.querySelector('.chat-panel__icon-button') as HTMLElement | null
      ;(textarea ?? closeButton ?? drawerRef.current)?.focus()
    } else {
      triggerRef?.current?.focus()
    }
  }, [isOpen, triggerRef])

  if (!isOpen) {
    return null
  }

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  const handleDrawerClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
  }

  return (
    <div
      className="chat-drawer-backdrop"
      onClick={handleBackdropClick}
      aria-hidden="false"
    >
      <div
        ref={drawerRef}
        id="chat-drawer"
        className="chat-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="OperAI Kitchen Assistant"
        tabIndex={-1}
        onClick={handleDrawerClick}
      >
        <ChatPanel
          chatData={chatData}
          voice={voice}
          onClose={onClose}
          title="OperAI Assistant"
          isMuted={isMuted}
          onToggleMute={onToggleMute}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  )
}
