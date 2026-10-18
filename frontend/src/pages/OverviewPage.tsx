/* ============================================================
   src/pages/OverviewPage.tsx
   OperAI Overview Dashboard — The single screen a kitchen owner opens first.
   Connected to documented backend API via centralized client and verified adapters.
   Honors AGENTS.md data integrity, request states, and explicit labeling.
   ============================================================ */

import type { PageId } from '../types/navigation'
import { useOverviewData } from '../hooks/useOverviewData'
import { KpiRow } from '../components/overview/KpiRow'
import { AiBriefingPanel } from '../components/overview/AiBriefingPanel'
import { PerformanceChart } from '../components/overview/PerformanceChart'
import { KitchenHealthPanel } from '../components/overview/KitchenHealthPanel'
import { IngredientAlertsPanel } from '../components/overview/IngredientAlertsPanel'
import { PrepTasksTimeline } from '../components/overview/PrepTasksTimeline'
import { NavIcon } from '../components/icons/NavIcon'
import './OverviewPage.css'

interface OverviewPageProps {
  onNavigate?: (pageId: PageId) => void
  /** Optional date override (YYYY-MM-DD in IST) */
  date?: string
}

const ICON_CALENDAR = 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'
const ICON_INFO = 'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm0-11v5m0-8h.01'
const ICON_ALERT = 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'

export function OverviewPage({ onNavigate, date }: OverviewPageProps) {
  const {
    mode,
    isLoading,
    error,
    isMissingConfig,
    isLive,
    formattedDate,
    kitchenName,
    planVersion,
    kpis,
    aiBriefing,
    ingredientAlerts,
    prepTasks,
    performanceData,
    stationHealth,
    avgStationUtilization,
    refetch,
    setMode
  } = useOverviewData({ date })

  // Compute contextual greeting
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning, Chef.' : hour < 17 ? 'Good afternoon, Chef.' : 'Good evening, Chef.'

  return (
    <article className="overview-page" aria-labelledby="overview-title">
      {/* ── 1. Page Introduction ──────────────────────────────── */}
      <header className="overview-intro">
        <div className="overview-intro__left">
          <div className="overview-intro__kicker-row">
            <span className="overview-intro__kicker">
              {kitchenName}
            </span>
            <span className="overview-intro__plan-badge">
              {planVersion}
            </span>
          </div>

          <h1 id="overview-title" className="overview-intro__title">
            {greeting}
          </h1>

          <p className="overview-intro__subtitle">
            Here is your kitchen’s daily operational overview, proactive shortage horizon, and prep readiness.
          </p>
        </div>

        <div className="overview-intro__right">
          {/* Date & Shift Badge */}
          <div className="overview-intro__date-pill">
            <NavIcon path={ICON_CALENDAR} size={14} className="overview-intro__cal-icon" />
            <span className="overview-intro__date-text">
              {formattedDate} · Shift 1 (Service Active)
            </span>
          </div>

          {/* Restrained Live / Demo Status Pill */}
          {isLive ? (
            <div className="overview-intro__live-pill" title="Live data connected to backend API">
              <span className="overview-intro__live-dot" aria-hidden="true" />
              <span className="overview-intro__live-label">Live Backend</span>
              <span className="overview-intro__live-hint">Connected</span>
            </div>
          ) : (
            <div className="overview-intro__demo-pill" title="Demo mode: Simulated metrics for UI demonstration">
              <span className="overview-intro__demo-dot" aria-hidden="true" />
              <span className="overview-intro__demo-label">Simulated Dataset</span>
              <span className="overview-intro__demo-hint">Demo Mode</span>
            </div>
          )}

          {/* Mode Switcher Action */}
          <button
            type="button"
            className="overview-mode-btn"
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
        </div>
      </header>

      {/* ── Notice: Missing Configuration in Demo Mode ─────────── */}
      {mode === 'demo' && isMissingConfig && (
        <div className="overview-banner overview-banner--info" role="region" aria-label="Configuration notice">
          <div className="overview-banner__content">
            <NavIcon path={ICON_INFO} size={15} />
            <strong className="overview-banner__title">Demo Mode Active:</strong>
            <span className="overview-banner__text">
              <code>VITE_API_KEY</code> is not configured in <code>frontend/.env</code>. Displaying simulated kitchen benchmark dataset.
            </span>
          </div>
          <button
            type="button"
            className="overview-banner__btn overview-banner__btn--ghost"
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
        <div className="overview-banner overview-banner--error" role="alert" aria-live="assertive">
          <div className="overview-banner__content">
            <NavIcon path={ICON_ALERT} size={15} />
            <strong className="overview-banner__title">Backend Connection Error:</strong>
            <span className="overview-banner__text">
              {error.message || 'Failed to fetch live kitchen telemetry.'}
            </span>
          </div>
          <div className="overview-banner__actions">
            <button
              type="button"
              className="overview-banner__btn overview-banner__btn--primary"
              onClick={refetch}
            >
              Retry Connection
            </button>
            <button
              type="button"
              className="overview-banner__btn overview-banner__btn--ghost"
              onClick={() => setMode('demo')}
            >
              Switch to Demo Data
            </button>
          </div>
        </div>
      )}

      {/* ── Main View State Switcher ───────────────────────────── */}
      {isLoading && mode === 'live' ? (
        <div className="overview-loading" role="status" aria-live="polite">
          <div className="overview-loading__spinner" aria-hidden="true" />
          <p className="overview-loading__text">
            Fetching daily orders, solver plan, and risk brief from OperAI backend...
          </p>
        </div>
      ) : mode === 'live' && error && !isLive ? (
        <div className="overview-fatal-error" role="alert">
          <div className="overview-fatal-error__icon">
            <NavIcon path={ICON_ALERT} size={24} />
          </div>
          <h2 className="overview-fatal-error__title">Live Dashboard Unavailable</h2>
          <p className="overview-fatal-error__desc">
            {error.message}
          </p>
          <div className="overview-fatal-error__actions">
            <button
              type="button"
              className="overview-banner__btn overview-banner__btn--primary"
              onClick={refetch}
            >
              Retry Connection
            </button>
            <button
              type="button"
              className="overview-banner__btn overview-banner__btn--ghost"
              onClick={() => setMode('demo')}
            >
              Switch to Demo Dataset
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── 2. KPI Row ────────────────────────────────────── */}
          <KpiRow kpis={kpis} />

          {/* ── 3. Main Dashboard Grid ────────────────────────── */}
          <div className="overview-grid">
            {/* Left Column (Primary Focus: AI Briefing, Performance, Prep Timeline) */}
            <div className="overview-grid__col overview-grid__col--main">
              {/* AI Kitchen Briefing */}
              <AiBriefingPanel briefing={aiBriefing} onNavigate={onNavigate} isLive={isLive} />

              {/* Performance Section: Revenue & Orders Visualization */}
              <PerformanceChart data={performanceData} />

              {/* Upcoming Prep Tasks */}
              <PrepTasksTimeline tasks={prepTasks} onNavigate={onNavigate} isLive={isLive} />
            </div>

            {/* Right Column (Operational Health & Urgencies) */}
            <aside className="overview-grid__col overview-grid__col--side" aria-label="Operational status and alerts">
              {/* Kitchen Health & Station Utilization (Simulated per Step 5) */}
              <KitchenHealthPanel stations={stationHealth} averageUtilization={avgStationUtilization} />

              {/* Ingredient Alerts */}
              <IngredientAlertsPanel alerts={ingredientAlerts} onNavigate={onNavigate} isLive={isLive} />

              {/* System Audit Note */}
              <div className="overview-audit-note">
                <NavIcon path={ICON_INFO} size={15} className="overview-audit-note__icon" />
                <div className="overview-audit-note__content">
                  {isLive ? (
                    <>
                      <strong>Live Operations Connected:</strong> Approved operational changes increment the immutable audit log and bump the solver plan version atomically per AGENTS.md rule 3.
                    </>
                  ) : (
                    <>
                      <strong>Simulated Environment:</strong> In production, approved operational changes increment the immutable audit log and bump the solver plan version atomically per AGENTS.md rule 3.
                    </>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </>
      )}
    </article>
  )
}
