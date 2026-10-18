/* ============================================================
   frontend/src/pages/AuditLogPage.tsx
   OperAI / Cloud Kitchen Rescue — Audit Log & Undo Timeline Page

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.14 (GET /api/audit)
   - docs/Rest_API_Spec.md §3.15 (POST /api/audit/{id}/undo)
   - docs/Rest_API_Spec.md §3.12 (POST /api/actions/{id}/approve)
   - docs/Database_Schema.md §3.10 (audit_logs table)
   - AGENTS.md (Rule 2: LLM never approves; Rule 3: Atomic approval;
                Rule 4: Explicit option number; Rule 5: Append-only audit log;
                Rule 6: Undo is pending action)
   ============================================================ */

import { useState, useCallback } from 'react'
import type { PageId } from '../types/navigation.ts'
import { useAuditLogData, type UseAuditLogDataOptions } from '../hooks/useAuditLogData.ts'
import { AuditSummaryCards } from '../components/audit/AuditSummaryCards.tsx'
import { AuditFilterToolbar } from '../components/audit/AuditFilterToolbar.tsx'
import { AuditTimelineList } from '../components/audit/AuditTimelineList.tsx'
import { AuditDetailModal } from '../components/audit/AuditDetailModal.tsx'
import { UndoProposalModal } from '../components/audit/UndoProposalModal.tsx'
import { ApprovalResultModal } from '../components/shortageRecovery/ApprovalResultModal.tsx'
import { AUDIT_EVENT_PRESENTATION_MAP } from '../api/index.ts'
import './AuditLogPage.css'

export interface AuditLogPageProps {
  /** Provided by AppLayout for cross-page navigation */
  readonly onNavigate?: (pageId: PageId) => void
  /** Optional data options for testing or custom client injection */
  readonly dataOptions?: UseAuditLogDataOptions
}

export function AuditLogPage({ onNavigate: _onNavigate, dataOptions }: AuditLogPageProps) {
  const {
    mode,
    isLive,
    isLoading,
    error,
    isMissingConfig,
    logs,
    summary,
    selectedLogId,
    selectedLog,
    setSelectedLogId,
    eventType,
    includeSnapshots,
    setEventType,
    setIncludeSnapshots,
    refetch,
    setMode,
    isProposingUndo,
    undoProposalError,
    undoResolutionError,
    stagedUndoProposal,
    requestUndoProposal,
    clearUndoProposal,
    isApprovingUndo,
    undoApprovalResult,
    undoApprovalError,
    postApprovalRefreshError,
    approveStagedUndo,
    clearUndoApprovalResult
  } = useAuditLogData(dataOptions)

  // Local state to track which specific card triggered the undo proposal
  const [proposingAuditId, setProposingAuditId] = useState<string | null>(null)

  // Request undo proposal handler
  const handleRequestUndo = useCallback(
    async (auditId: string) => {
      setProposingAuditId(auditId)
      try {
        await requestUndoProposal(auditId)
      } finally {
        setProposingAuditId(null)
      }
    },
    [requestUndoProposal]
  )

  // Approve staged undo handler
  const handleApproveUndo = useCallback(async () => {
    await approveStagedUndo()
  }, [approveStagedUndo])

  return (
    <div className="audit-page" role="region" aria-label="Audit Log & Governance">
      {/* ── 1. Page Header ────────────────────────────────────────── */}
      <header className="audit-header">
        <div className="audit-header__left">
          <div className="audit-header__title-group">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="audit-header__icon"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <h1 className="audit-header__title">Audit Log</h1>
          </div>
          <p className="audit-header__subtitle">
            Tamper-evident, append-only operational timeline recording kitchen mutations, plan version transitions, and approval-gated rollbacks.
          </p>
        </div>

        {/* Header Controls: Live/Demo status and Refresh */}
        <div className="audit-header__right">
          <div className="audit-mode-cluster">
            <div
              className={`audit-mode-pill ${
                isLive
                  ? 'audit-mode-pill--live'
                  : mode === 'live' && isLoading
                  ? 'audit-mode-pill--sync'
                  : 'audit-mode-pill--demo'
              }`}
              title={
                isLive
                  ? 'Connected to live Supabase Postgres backend'
                  : mode === 'live' && isLoading
                  ? 'Syncing audit log from backend API'
                  : 'Running in simulated demonstration mode'
              }
            >
              <span className="audit-mode-pill__dot" />
              <span>
                {isLive
                  ? 'Live API'
                  : mode === 'live' && isLoading
                  ? 'Syncing...'
                  : 'Demo Mode'}
              </span>
            </div>

            <button
              type="button"
              className="audit-btn-toggle-mode"
              onClick={() => setMode(mode === 'live' ? 'demo' : 'live')}
            >
              {mode === 'live' ? 'Switch to Demo' : 'Connect to Live API'}
            </button>
          </div>

          <button
            type="button"
            className="audit-btn-refresh-header"
            onClick={() => refetch()}
            disabled={isLoading}
            aria-label={isLoading ? 'Syncing audit records...' : 'Refresh audit records'}
          >
            <span aria-hidden="true">🔄</span>
            <span>{isLoading ? 'Syncing...' : 'Refresh'}</span>
          </button>
        </div>
      </header>

      {/* ── 2. System Policy & Config Banners ──────────────────────── */}
      {isMissingConfig && mode === 'demo' && (
        <div className="audit-banner audit-banner--info" role="status">
          <span className="audit-banner__icon" aria-hidden="true">ℹ</span>
          <div className="audit-banner__content">
            <strong>Demonstration Mode:</strong> <code>VITE_API_KEY</code> is unconfigured in <code>.env</code>.
            Displaying simulated historical audit logs (<code>data_source = 'simulated'</code>). Reversal actions are disabled.
          </div>
        </div>
      )}

      {/* Post-Approval Sync Warning Notice if Background Fetch Failed */}
      {postApprovalRefreshError && (
        <div className="audit-banner audit-banner--warning" role="alert">
          <span className="audit-banner__icon" aria-hidden="true">⚠️</span>
          <div className="audit-banner__content">
            <strong>Background Sync Notice:</strong> The undo action was approved successfully, but refreshing the audit timeline encountered an error: {postApprovalRefreshError}. Current records may be stale.
          </div>
        </div>
      )}

      {/* System Governance Banner */}
      <div className="audit-banner audit-banner--policy">
        <span className="audit-banner__icon" aria-hidden="true">🔒</span>
        <div className="audit-banner__content">
          <strong>OperAI Audit Governance (AGENTS.md):</strong> Audit logs are append-only. No records are ever modified or deleted.
          Undos are executed strictly as approval-gated pending proposals using snapshot restores. Automatic rollbacks are strictly forbidden.
        </div>
      </div>

      {/* ── 3. Summary Metric Cards ────────────────────────────────── */}
      <AuditSummaryCards
        summary={summary}
        isLoading={isLoading && logs.length === 0}
        isFiltered={Boolean(eventType)}
        activeFilterLabel={eventType ? AUDIT_EVENT_PRESENTATION_MAP[eventType]?.label : undefined}
      />

      {/* ── 4. Filter Toolbar ──────────────────────────────────────── */}
      <AuditFilterToolbar
        activeEventType={eventType}
        onSelectEventType={setEventType}
        includeSnapshots={includeSnapshots}
        onToggleIncludeSnapshots={setIncludeSnapshots}
        onRefresh={() => refetch()}
        isLoading={isLoading}
        totalShown={logs.length}
      />

      {/* ── 5. Main Content: Error / Timeline List ─────────────────── */}
      {error && logs.length === 0 ? (
        <div className="audit-error-card" role="alert">
          <span className="audit-error-card__icon" aria-hidden="true">⚠️</span>
          <h2 className="audit-error-card__title">Failed to Load Audit Records</h2>
          <p className="audit-error-card__message">
            {error.message || 'An error occurred while fetching audit logs from the backend API.'}
          </p>
          <button
            type="button"
            className="audit-error-card__retry-btn"
            onClick={() => refetch()}
          >
            Retry Fetch
          </button>
        </div>
      ) : (
        <AuditTimelineList
          logs={logs}
          selectedLogId={selectedLogId}
          onSelectLog={setSelectedLogId}
          onRequestUndo={handleRequestUndo}
          isProposingUndo={isProposingUndo}
          proposingAuditId={proposingAuditId}
          isLive={isLive}
          isLoading={isLoading}
          onResetFilter={() => setEventType(undefined)}
        />
      )}

      {/* ── 6. Modals & Dialogs ────────────────────────────────────── */}

      {/* Detail & Snapshot Comparison Modal */}
      <AuditDetailModal
        log={selectedLog}
        includeSnapshots={includeSnapshots}
        onEnableSnapshots={() => setIncludeSnapshots(true)}
        onClose={() => setSelectedLogId(null)}
        onRequestUndo={handleRequestUndo}
        isProposingUndo={isProposingUndo}
        isLive={isLive}
      />

      {/* Safety-Gated Undo Proposal Modal */}
      <UndoProposalModal
        proposal={stagedUndoProposal}
        isOpen={stagedUndoProposal !== null}
        isApproving={isApprovingUndo}
        undoResolutionError={undoResolutionError}
        undoApprovalError={undoApprovalError || undoProposalError}
        onApprove={handleApproveUndo}
        onClose={clearUndoProposal}
        isLive={isLive}
      />

      {/* Post-Approval Result Modal (Reused from shortageRecovery) */}
      <ApprovalResultModal
        result={undoApprovalResult}
        postApprovalRefreshError={postApprovalRefreshError}
        onClose={clearUndoApprovalResult}
      />
    </div>
  )
}
