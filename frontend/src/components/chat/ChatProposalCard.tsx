/* ============================================================
   frontend/src/components/chat/ChatProposalCard.tsx
   OperAI / Cloud Kitchen Rescue — Conversational Proposal Card

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.16 (POST /api/agent/chat)
   - AGENTS.md (Rule 2: LLM can never approve, reject, or execute)

   SAFETY INVARIANTS:
   1. Displays only fields supported by the chat view model.
   2. Handles absent actionGroupId or optionActionIds honestly.
   3. NEVER fabricates option numbers or fake action identifiers.
   4. Absolutely NO approve, reject, undo, or execution buttons.
      Execution occurs strictly via POST /api/actions/{id}/approve on
      the Shortage & Recovery review board.
   ============================================================ */

import type { PageId } from '../../types/navigation.ts'
import './ChatProposalCard.css'

export interface ChatProposalCardProps {
  readonly actionGroupId?: string
  readonly optionActionIds?: readonly string[]
  readonly confirmPhrases?: readonly string[]
  readonly requiresConfirmation?: boolean
  readonly isSimulated?: boolean
  readonly className?: string
  readonly onNavigate?: (pageId: PageId) => void
}

export function ChatProposalCard({
  actionGroupId,
  optionActionIds,
  confirmPhrases = [],
  requiresConfirmation = false,
  isSimulated = false,
  className = '',
  onNavigate
}: ChatProposalCardProps) {
  const hasValidGroupId = typeof actionGroupId === 'string' && actionGroupId.trim().length > 0
  const hasValidActionIds = Array.isArray(optionActionIds) && optionActionIds.length > 0
  const hasConfirmPhrases = Array.isArray(confirmPhrases) && confirmPhrases.length > 0

  if (!requiresConfirmation && !hasValidGroupId && !hasConfirmPhrases) {
    return null
  }

  const cardClasses = [
    'chat-proposal-card',
    isSimulated ? 'chat-proposal-card--simulated' : '',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cardClasses}
      role="region"
      aria-label={isSimulated ? 'Simulated Recovery Proposal' : 'Recovery Proposal Details'}
    >
      <div className="chat-proposal-card__header">
        <div className="chat-proposal-card__title">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span>{isSimulated ? 'Simulated Recovery Options' : 'Candidate Recovery Options'}</span>
        </div>
        <span
          className={`chat-proposal-card__badge ${
            isSimulated ? 'chat-proposal-card__badge--simulated' : ''
          }`}
        >
          {isSimulated ? 'Simulated Proposal' : 'Pending Confirmation'}
        </span>
      </div>

      {(hasValidGroupId || hasValidActionIds) && (
        <div className="chat-proposal-card__meta">
          {hasValidGroupId && (
            <span className="chat-proposal-card__meta-item">
              Group: {actionGroupId}
            </span>
          )}
          {hasValidActionIds && (
            <span className="chat-proposal-card__meta-item">
              Options Available: {optionActionIds.length}
            </span>
          )}
        </div>
      )}

      {hasConfirmPhrases && (
        <>
          <div className="chat-proposal-card__phrases-label">
            Recognized confirmation phrases:
          </div>
          <div className="chat-proposal-card__phrases" role="list">
            {confirmPhrases.map((phrase) => (
              <span key={phrase} className="chat-proposal-card__phrase-chip" role="listitem">
                "{phrase}"
              </span>
            ))}
          </div>
        </>
      )}

      {onNavigate && (
        <div className="chat-proposal-card__actions">
          <button
            type="button"
            className="chat-proposal-card__nav-button"
            onClick={() => onNavigate('shortage-recovery')}
            aria-label="View proposal in Shortage and Recovery board"
          >
            <span>View in Shortage & Recovery</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>
      )}

      <div className="chat-proposal-card__disclaimer">
        <svg
          className="chat-proposal-card__disclaimer-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>
          {isSimulated
            ? 'Demo Mode: Proposal is simulated and cannot be executed.'
            : 'Informational proposal only. Approvals are strictly verified via Shortage & Recovery.'}
        </span>
      </div>
    </div>
  )
}
