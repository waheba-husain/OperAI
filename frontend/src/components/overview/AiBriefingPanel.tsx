/* ============================================================
   src/components/overview/AiBriefingPanel.tsx
   Prominent, distinctive panel for the AI-generated kitchen briefing.
   Features a restrained green treatment, operational observations,
   and a clear next-step action.
   Clearly labeled as an illustrative demo briefing.
   ============================================================ */

import type { AiKitchenBriefing } from '../../types/overview'
import type { PageId } from '../../types/navigation'
import { NavIcon } from '../icons/NavIcon'
import './AiBriefingPanel.css'

interface AiBriefingPanelProps {
  briefing: AiKitchenBriefing
  onNavigate?: (pageId: PageId) => void
  isLive?: boolean
}

const ICON_SPARK = 'M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z'
const ICON_ARROW = 'M5 12h14m-7-7l7 7-7 7'

export function AiBriefingPanel({ briefing, onNavigate, isLive = false }: AiBriefingPanelProps) {
  const handleActionClick = () => {
    if (briefing.recommendedAction.targetPageId && onNavigate) {
      onNavigate(briefing.recommendedAction.targetPageId as PageId)
    }
  }

  return (
    <section className="ai-briefing-panel" aria-labelledby="ai-briefing-title">
      <header className="ai-briefing-panel__header">
        <div className="ai-briefing-panel__meta">
          <div className="ai-briefing-panel__badge-row">
            <span className="ai-briefing-pill">
              <NavIcon path={ICON_SPARK} size={13} className="ai-briefing-pill__spark" />
              <span>OperAI Co-Pilot</span>
            </span>
            <span className={`ai-briefing-demo-pill ${isLive ? 'is-live' : ''}`}>
              {isLive ? 'Live Synthesis' : 'Simulated AI Demo'}
            </span>
          </div>

          <h2 id="ai-briefing-title" className="ai-briefing-panel__title">
            {briefing.title}
          </h2>
          <span className="ai-briefing-panel__timestamp">
            {briefing.timestamp} · Bedrock Claude 3.5 Sonnet {isLive ? '(Live Evaluation)' : '(Simulated Output)'}
          </span>
        </div>
      </header>

      {/* Observations list */}
      <div className="ai-briefing-panel__observations" role="list">
        {briefing.observations.map(obs => (
          <div
            key={obs.id}
            className={`ai-obs-item ai-obs-item--${obs.urgency}`}
            role="listitem"
          >
            <div className="ai-obs-item__indicator" aria-hidden="true" />
            <div className="ai-obs-item__body">
              <span className="ai-obs-item__tag">{obs.tag}</span>
              <p className="ai-obs-item__text">{obs.text}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Recommended Next Step Callout */}
      <footer className="ai-briefing-action-box">
        <div className="ai-briefing-action-box__content">
          <span className="ai-briefing-action-box__label">Recommended Next Action</span>
          <p className="ai-briefing-action-box__desc">
            {briefing.recommendedAction.description}
          </p>
        </div>

        <button
          type="button"
          className="ai-briefing-action-btn"
          onClick={handleActionClick}
          aria-label={`${briefing.recommendedAction.targetLabel} (Navigate to Shortage Recovery)`}
        >
          <span>{briefing.recommendedAction.targetLabel}</span>
          <NavIcon path={ICON_ARROW} size={15} />
        </button>
      </footer>
    </section>
  )
}
