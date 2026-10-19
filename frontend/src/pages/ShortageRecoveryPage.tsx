/* ============================================================
   frontend/src/pages/ShortageRecoveryPage.tsx
   OperAI / Cloud Kitchen Rescue — Shortage & Recovery Control Center

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.9 (GET /api/brief?date=YYYY-MM-DD)
   - docs/Rest_API_Spec.md §3.10 (POST /api/recovery/propose)
   - docs/Rest_API_Spec.md §3.11 (GET /api/actions)
   - docs/Rest_API_Spec.md §3.12 (POST /api/actions/{id}/approve)
   - docs/Rest_API_Spec.md §3.13 (POST /api/actions/{id}/reject)
   - AGENTS.md (Rule 1: Numbers from code; Rule 2: LLM can never approve; Rule 4: Explicit option number)
   - frontend/docs/stage-2.4e-approval-replanning-integration.md
   ============================================================ */

import { useShortageRecoveryData } from '../hooks/useShortageRecoveryData.ts'
import type { UseShortageRecoveryDataOptions } from '../hooks/useShortageRecoveryData.ts'
import { getTodayDateIST } from '../hooks/useOverviewData.ts'
import { formatActionErrorMessage } from '../api/adapters/actionAdapter.ts'
import { ShortageRiskPanel } from '../components/shortageRecovery/ShortageRiskPanel.tsx'
import { RecoverySimulationResults } from '../components/shortageRecovery/RecoverySimulationResults.tsx'
import { PendingActionsList } from '../components/shortageRecovery/PendingActionsList.tsx'
import { ApprovalResultModal } from '../components/shortageRecovery/ApprovalResultModal.tsx'
import type { PageId } from '../types/navigation.ts'
import './ShortageRecoveryPage.css'

export interface ShortageRecoveryPageProps {
  /** Provided by AppLayout so panels can navigate to related pages */
  readonly onNavigate?: (pageId: PageId) => void
  /** Optional data options for testing or custom client injection */
  readonly dataOptions?: UseShortageRecoveryDataOptions
}

function shiftDate(dateStr: string, deltaDays: number): string {
  try {
    const [year, month, day] = dateStr.split('-').map(Number)
    if (!year || !month || !day) return dateStr
    const dt = new Date(Date.UTC(year, month - 1, day + deltaDays, 12, 0, 0))
    return dt.toISOString().slice(0, 10)
  } catch {
    return dateStr
  }
}

export function ShortageRecoveryPage({
  dataOptions
}: ShortageRecoveryPageProps) {
  const {
    mode,
    isLive,
    isLoading,
    isProposing,
    isApprovingActionId,
    isRejectingActionId,
    error,
    proposalError,
    actionMutationError,
    postApprovalRefreshError,
    latestApprovalResult,
    latestRejectionResult,
    isMissingConfig,
    targetDate,
    formattedDate,
    summary,
    shortages,
    atRiskOrders,
    proposal,
    pendingActions,
    isLoadingActions,
    actionsError,
    selectedIngredientId,
    setSelectedIngredientId,
    setTargetDate,
    requestRecoveryProposal,
    approveRecoveryOption,
    rejectRecoveryOption,
    clearApprovalResult,
    clearRejectionResult,
    clearActionMutationError,
    clearProposal,
    refetch,
    refetchActions,
    setMode
  } = useShortageRecoveryData(dataOptions)

  const todayStr = getTodayDateIST()
  const isToday = targetDate === todayStr

  const handlePrevDay = () => setTargetDate(shiftDate(targetDate, -1))
  const handleNextDay = () => setTargetDate(shiftDate(targetDate, 1))
  const handleToday = () => setTargetDate(todayStr)

  return (
    <div className="shortage-recovery-page">
      {/* Policy Governance Banner */}
      <div className="shortage-policy-banner" role="region" aria-label="Governance rules">
        <span className="shortage-policy-badge">STRICT AUDIT POLICY</span>
        <span className="shortage-policy-text">
          Numbers computed by backend engine only. AI evaluates candidate options but cannot approve, reject, or execute changes. Approval requires explicit operator click and transmits exact option number.
        </span>
      </div>

      {/* Top Header & Operational Date Controls */}
      <header className="shortage-recovery-header">
        <div className="shortage-recovery-header__info">
          <span className="shortage-recovery-header__kicker">OPERATIONAL RESILIENCE</span>
          <h1 className="shortage-recovery-header__title">
            Shortage Radar & Recovery Simulator
          </h1>
          <p className="shortage-recovery-header__subtitle">
            Identify inventory shortfalls ahead of prep deadlines, simulate multi-option recovery formulations, and explicitly approve kitchen plan modifications.
          </p>
        </div>

        <div className="shortage-recovery-header__controls">
          {/* Live vs Demo Pill */}
          <div className="shortage-recovery-mode-group">
            <span
              className={`shortage-mode-indicator ${
                mode === 'live'
                  ? isLive
                    ? 'shortage-mode-indicator--live'
                    : isLoading
                      ? 'shortage-mode-indicator--sync'
                      : 'shortage-mode-indicator--error'
                  : 'shortage-mode-indicator--demo'
              }`}
            >
              <span className="shortage-mode-dot" aria-hidden="true" />
              {mode === 'live'
                ? isLive
                  ? 'LIVE BACKEND'
                  : isLoading
                    ? 'SYNCING...'
                    : 'LIVE ERROR'
                : 'SIMULATED DEMO'}
            </span>

            <button
              type="button"
              className="shortage-mode-toggle-btn"
              onClick={() => setMode(mode === 'live' ? 'demo' : 'live')}
              title={`Switch to ${mode === 'live' ? 'Demo' : 'Live'} mode`}
            >
              Switch to {mode === 'live' ? 'Demo' : 'Live'}
            </button>
          </div>

          {/* Date Picker Controls */}
          <div className="shortage-date-controls" role="group" aria-label="Service date navigation">
            <button
              type="button"
              className="shortage-date-nav-btn"
              onClick={handlePrevDay}
              aria-label="Previous service day"
            >
              ‹
            </button>
            <input
              type="date"
              className="shortage-date-input"
              value={targetDate}
              onChange={(e) => {
                if (e.target.value) setTargetDate(e.target.value)
              }}
              aria-label="Target service date"
            />
            <button
              type="button"
              className="shortage-date-nav-btn"
              onClick={handleNextDay}
              aria-label="Next service day"
            >
              ›
            </button>
            <button
              type="button"
              className={`shortage-today-btn ${isToday ? 'shortage-today-btn--active' : ''}`}
              onClick={handleToday}
            >
              Today
            </button>
          </div>

          {/* Refresh Action */}
          <button
            type="button"
            className="shortage-refresh-btn"
            onClick={() => {
              void refetch()
              void refetchActions()
            }}
            disabled={isLoading || isLoadingActions}
            title="Refresh brief data and actions from backend"
          >
            {isLoading || isLoadingActions ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </div>
      </header>

      {/* Primary KPI Summary Ribbon */}
      <section className="shortage-summary-ribbon" aria-label="Shortage summary metrics">
        <div className="shortage-summary-card">
          <span className="shortage-summary-card__label">Active Shortages</span>
          <span className="shortage-summary-card__value shortage-summary-card__value--negative">
            {summary.shortageCount}
          </span>
          <span className="shortage-summary-card__tag">
            {summary.shortageCount === 0 ? 'Stock Balanced' : 'Action Required'}
          </span>
        </div>

        <div className="shortage-summary-card">
          <span className="shortage-summary-card__label">At-Risk Orders</span>
          <span className="shortage-summary-card__value shortage-summary-card__value--warning">
            {summary.atRiskOrderCount}
          </span>
          <span className="shortage-summary-card__tag">Impacting Delivery</span>
        </div>

        <div className="shortage-summary-card">
          <span className="shortage-summary-card__label">Total Revenue Exposure</span>
          <span className="shortage-summary-card__value shortage-summary-card__value--negative">
            {summary.revenueAtRiskFormatted}
          </span>
          <span className="shortage-summary-card__tag">Computed by Backend</span>
        </div>

        <div className="shortage-summary-card">
          <span className="shortage-summary-card__label">Data Source</span>
          <span className="shortage-summary-card__value">
            {summary.dataSource === 'live' ? 'Live DB' : 'Simulated'}
          </span>
          <span className="shortage-summary-card__tag">
            {formattedDate}
          </span>
        </div>
      </section>

      {/* Missing Config Notification */}
      {isMissingConfig && (
        <div className="shortage-alert-card shortage-alert-card--warning" role="alert">
          <div className="shortage-alert-icon" aria-hidden="true">⚠️</div>
          <div className="shortage-alert-body">
            <h3 className="shortage-alert-title">Live API Configuration Incomplete</h3>
            <p className="shortage-alert-desc">
              Missing <code>VITE_API_URL</code> or <code>VITE_API_KEY</code>. You can preview demo recovery workflows or provide configuration in your environment.
            </p>
          </div>
        </div>
      )}

      {/* Brief Fetch Error */}
      {error && (
        <div className="shortage-alert-card shortage-alert-card--error" role="alert">
          <div className="shortage-alert-icon" aria-hidden="true">✕</div>
          <div className="shortage-alert-body">
            <h3 className="shortage-alert-title">
              Failed to Fetch Operational Brief {'status' in error ? `(${(error as { status: number }).status})` : ''}
            </h3>
            <p className="shortage-alert-desc">{error.message}</p>
            <div className="shortage-alert-actions">
              <button
                type="button"
                className="shortage-alert-btn"
                onClick={() => void refetch()}
              >
                Retry Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Proposal Request Error */}
      {proposalError && (
        <div className="shortage-alert-card shortage-alert-card--warning" role="alert">
          <div className="shortage-alert-icon" aria-hidden="true">⚠️</div>
          <div className="shortage-alert-body">
            <h3 className="shortage-alert-title">
              Recovery Simulation Notice {'status' in proposalError ? `(${(proposalError as { status: number }).status})` : ''}
            </h3>
            <p className="shortage-alert-desc">{proposalError.message}</p>
            {'status' in proposalError && (proposalError as { status: number }).status === 409 && (
              <p className="shortage-alert-tip">
                Inventory for this ingredient already covers current scheduled dish requirements. To force recovery simulation, enter a lower physical stock figure in the input field above.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Action Mutation Conflict / Failure Alert */}
      {actionMutationError && (
        <div className="shortage-alert-card shortage-alert-card--conflict" role="alert">
          <div className="shortage-alert-icon" aria-hidden="true">⚠️</div>
          <div className="shortage-alert-body" style={{ flex: 1 }}>
            <h3 className="shortage-alert-title">
              Action Decision Failed for Action <code>{actionMutationError.actionId}</code>
            </h3>
            <p className="shortage-alert-desc">
              {formatActionErrorMessage(actionMutationError.error)}
            </p>
          </div>
          <button
            type="button"
            className="shortage-alert-dismiss-btn"
            onClick={clearActionMutationError}
            aria-label="Dismiss action error alert"
          >
            ✕
          </button>
        </div>
      )}

      {/* Successful Rejection Notification */}
      {latestRejectionResult && (
        <div className="shortage-alert-card shortage-alert-card--success" role="status">
          <div className="shortage-alert-icon" aria-hidden="true">✓</div>
          <div className="shortage-alert-body" style={{ flex: 1 }}>
            <h3 className="shortage-alert-title">Option Declined</h3>
            <p className="shortage-alert-desc">
              Action <code>{latestRejectionResult.actionId}</code> was declined and recorded in the audit trail (Log #{latestRejectionResult.auditId}) at {latestRejectionResult.decidedAtFormatted}. No plan or stock changes were applied.
            </p>
          </div>
          <button
            type="button"
            className="shortage-alert-dismiss-btn"
            onClick={clearRejectionResult}
            aria-label="Dismiss rejection notice"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Two-Column or Stacked Workspace */}
      <div className="shortage-workspace">
        {/* Identified Shortages & Affected Orders List */}
        <ShortageRiskPanel
          shortages={shortages}
          atRiskOrders={atRiskOrders}
          isProposing={isProposing}
          selectedIngredientId={selectedIngredientId}
          onSelectIngredient={(id) => setSelectedIngredientId(id)}
          onRequestProposal={(ingredientId, reportedQty) => {
            void requestRecoveryProposal(ingredientId, reportedQty)
          }}
        />

        {/* Solver Simulation Results & Option Cards & Pending Actions */}
        <div className="shortage-recovery-column">
          <RecoverySimulationResults
            proposal={proposal}
            isProposing={isProposing}
            onClearProposal={clearProposal}
            onApprove={(actionId, optionNumber) => {
              void approveRecoveryOption(actionId, optionNumber)
            }}
            onReject={(actionId) => {
              void rejectRecoveryOption(actionId)
            }}
            isApprovingActionId={isApprovingActionId}
            isRejectingActionId={isRejectingActionId}
            actionMutationError={actionMutationError}
            isDemoMode={mode === 'demo'}
          />

          {mode === 'live' && (
            <PendingActionsList
              pendingActions={pendingActions}
              isLoading={isLoadingActions}
              error={actionsError}
              onRefresh={() => void refetchActions()}
              onApprove={(actionId, optionNumber) => {
                void approveRecoveryOption(actionId, optionNumber)
              }}
              onReject={(actionId) => {
                void rejectRecoveryOption(actionId)
              }}
              isApprovingActionId={isApprovingActionId}
              isRejectingActionId={isRejectingActionId}
              isDemoMode={false}
            />
          )}
        </div>
      </div>

      {/* Post-Approval Result Modal */}
      {latestApprovalResult && (
        <ApprovalResultModal
          result={latestApprovalResult}
          postApprovalRefreshError={postApprovalRefreshError}
          onClose={clearApprovalResult}
        />
      )}
    </div>
  )
}
