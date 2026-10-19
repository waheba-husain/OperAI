/* ============================================================
   src/pages/LiveOperationsPage.tsx
   OperAI Live Operations — Kitchen control centre view.
   Composed from 5 distinct, data-rich panels.
   All operational data is explicitly simulated per AGENTS.md rule 9.
   ============================================================ */

import type { PageId } from '../types/navigation'
import { OpsSummaryBar }   from '../components/liveOps/OpsSummaryBar'
import { OrderQueue }      from '../components/liveOps/OrderQueue'
import { PrepTimeline }    from '../components/liveOps/PrepTimeline'
import { StationsPanel }   from '../components/liveOps/StationsPanel'
import { OpsAlertsPanel }  from '../components/liveOps/OpsAlertsPanel'
import { NavIcon }         from '../components/icons/NavIcon'
import { useLiveOpsData, type UseLiveOpsDataOptions } from '../hooks/useLiveOpsData'
import './LiveOperationsPage.css'

/* ── Used for the page header and banner icons ────────────── */
const ICON_ACTIVITY = 'M22 12h-4l-3 9L9 3l-3 9H2'
const ICON_CALENDAR = 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'
const ICON_INFO     = 'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm0-11v5m0-8h.01'
const ICON_ALERT    = 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01'

interface LiveOperationsPageProps {
  /** Provided by AppLayout so panels can navigate to related pages */
  readonly onNavigate?: (pageId: PageId) => void
  /** Optional data options for testing or custom client injection */
  readonly dataOptions?: UseLiveOpsDataOptions
}

export function LiveOperationsPage({ dataOptions }: LiveOperationsPageProps) {
  const {
    mode,
    isLoading,
    error,
    isMissingConfig,
    isLive,
    kitchenName,
    planVersion,
    snapshotTime,
    shift,
    metrics,
    orders,
    prepTasks,
    stations,
    alerts,
    refetch,
    setMode
  } = useLiveOpsData(dataOptions)

  return (
    <article className="liveops-page" aria-labelledby="liveops-title">

      {/* ── 1. Page Header ────────────────────────────────── */}
      <header className="liveops-header">
        <div className="liveops-header__left">
          <div className="liveops-header__kicker-row">
            <span className="liveops-header__kicker">
              {kitchenName}
            </span>
            <span className="liveops-header__plan-badge">
              {planVersion}
            </span>
          </div>

          <div className="liveops-header__title-row">
            <NavIcon path={ICON_ACTIVITY} size={24} className="liveops-header__title-icon" />
            <h1 id="liveops-title" className="liveops-header__title">
              Live Operations
            </h1>
          </div>

          <p className="liveops-header__subtitle">
            Real-time kitchen control centre — order queue, prep tracking, and station workload.
          </p>
        </div>

        <div className="liveops-header__right">
          <div className="liveops-header__date-pill">
            <NavIcon path={ICON_CALENDAR} size={13} className="liveops-header__cal-icon" />
            <span>{shift}</span>
          </div>

          {/* Kitchen status indicator */}
          <div className="liveops-header__status-chip" aria-label="Kitchen status: Live - Service Ongoing">
            <span className="liveops-status-dot" aria-hidden="true" />
            <span className="liveops-status-label">Service Ongoing</span>
          </div>

          {/* Restrained Live / Demo Status Pill */}
          {isLive ? (
            <div className="liveops-header__live-pill" title="Live data connected to backend API">
              <span className="liveops-header__live-dot" aria-hidden="true" />
              <span className="liveops-header__live-label">Live Backend</span>
              <span className="liveops-header__live-hint">Connected</span>
            </div>
          ) : (
            <div className="liveops-header__demo-pill" title="Demo mode — simulated operational data">
              <span className="liveops-header__demo-dot" aria-hidden="true" />
              <span className="liveops-header__demo-label">Simulated</span>
              <span className="liveops-header__demo-hint">Demo Mode</span>
            </div>
          )}

          {/* Mode Switcher Action */}
          <button
            type="button"
            className="liveops-mode-btn"
            onClick={() => {
              if (mode === 'live') {
                setMode('demo')
              } else {
                setMode('live')
                refetch()
              }
            }}
          >
            {mode === 'live' ? 'View Demo Data' : 'Connect Live Backend'}
          </button>

          <div
            className="liveops-header__snapshot-time"
            title={isLive ? 'Client-side refresh timestamp' : 'Simulated benchmark timestamp'}
          >
            {isLive ? `Refreshed: ${snapshotTime}` : snapshotTime}
          </div>
        </div>
      </header>

      {/* ── Notice: Missing Configuration in Demo Mode ─────────── */}
      {mode === 'demo' && isMissingConfig && (
        <div className="liveops-banner liveops-banner--info" role="region" aria-label="Configuration notice">
          <div className="liveops-banner__content">
            <NavIcon path={ICON_INFO} size={15} />
            <strong className="liveops-banner__title">Demo Mode Active:</strong>
            <span className="liveops-banner__text">
              <code>VITE_API_KEY</code> is not configured in <code>frontend/.env</code>. Displaying simulated kitchen operations dataset.
            </span>
          </div>
          <button
            type="button"
            className="liveops-banner__btn liveops-banner__btn--ghost"
            onClick={() => {
              setMode('live')
              refetch()
            }}
          >
            Retry Live Connection
          </button>
        </div>
      )}

      {/* ── Notice: Live API Error Banner ───────────────────────── */}
      {mode === 'live' && error && (
        <div className="liveops-banner liveops-banner--error" role="alert" aria-live="assertive">
          <div className="liveops-banner__content">
            <NavIcon path={ICON_ALERT} size={15} />
            <strong className="liveops-banner__title">Backend Connection Error:</strong>
            <span className="liveops-banner__text">
              {error.message || 'Failed to fetch live kitchen telemetry.'}
            </span>
          </div>
          <div className="liveops-banner__actions">
            <button
              type="button"
              className="liveops-banner__btn liveops-banner__btn--primary"
              onClick={refetch}
            >
              Retry Connection
            </button>
            <button
              type="button"
              className="liveops-banner__btn liveops-banner__btn--ghost"
              onClick={() => setMode('demo')}
            >
              Switch to Demo Data
            </button>
          </div>
        </div>
      )}

      {/* ── Main View State Switcher ───────────────────────────── */}
      {isLoading && mode === 'live' ? (
        <div className="liveops-loading" role="status" aria-live="polite">
          <div className="liveops-loading__spinner" aria-hidden="true" />
          <p className="liveops-loading__text">
            Fetching active orders, solver schedule, and operational alerts from OperAI backend...
          </p>
        </div>
      ) : mode === 'live' && error && !isLive ? (
        <div className="liveops-fatal-error" role="alert">
          <div className="liveops-fatal-error__icon">
            <NavIcon path={ICON_ALERT} size={24} />
          </div>
          <h2 className="liveops-fatal-error__title">Live Operations Unavailable</h2>
          <p className="liveops-fatal-error__desc">
            {error.message}
          </p>
          <div className="liveops-fatal-error__actions">
            <button
              type="button"
              className="liveops-banner__btn liveops-banner__btn--primary"
              onClick={refetch}
            >
              Retry Connection
            </button>
            <button
              type="button"
              className="liveops-banner__btn liveops-banner__btn--ghost"
              onClick={() => setMode('demo')}
            >
              Switch to Demo Data
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── 2. Operational Summary Bar ────────────────────── */}
          <OpsSummaryBar metrics={metrics} />

          {/* ── 3. Main Content Grid ──────────────────────────── */}
          <div className="liveops-grid">

            {/* ── Left / Main Column ─────────────────────────── */}
            <div className="liveops-grid__main">

              {/* Order Queue — primary focal point */}
              <OrderQueue orders={orders} isLive={isLive} />

              {/* Preparation Timeline — vertical stepped list */}
              <PrepTimeline tasks={prepTasks} isLive={isLive} planVersion={planVersion} />

            </div>

            {/* ── Right / Side Column ───────────────────────── */}
            <aside className="liveops-grid__side" aria-label="Station health and operational alerts">

              {/* Station Workload Overview (simulated telemetry per backend contract) */}
              <StationsPanel stations={stations} />

              {/* Operational Alerts */}
              <OpsAlertsPanel alerts={alerts} isLive={isLive} />

            </aside>
          </div>
        </>
      )}

    </article>
  )
}
