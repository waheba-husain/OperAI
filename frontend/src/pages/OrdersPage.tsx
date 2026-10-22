/* ============================================================
   frontend/src/pages/OrdersPage.tsx
   OperAI / Cloud Kitchen Rescue — Kitchen Orders Management Page

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.5 (GET /api/orders)
   - docs/Database_Schema.md §3.6 (orders) & §3.7 (order_items)
   - docs/PRD.md §5 (Order intake, channel fulfilment, customer drafts)
   - AGENTS.md (Rule 1: Numbers from code; Rule 9: Honest data labels)
   ============================================================ */

import { useState } from 'react'
import type { PageId } from '../types/navigation.ts'
import { useOrdersData, type UseOrdersDataOptions } from '../hooks/useOrdersData.ts'
import { OrdersSummaryCards } from '../components/orders/OrdersSummaryCards.tsx'
import { OrdersFilterToolbar } from '../components/orders/OrdersFilterToolbar.tsx'
import { OrdersTable } from '../components/orders/OrdersTable.tsx'
import { OrderDetailModal } from '../components/orders/OrderDetailModal.tsx'
import { NavIcon } from '../components/icons/NavIcon.tsx'
import './OrdersPage.css'

/* ── SVG Paths used for headers & alerts ── */
const ICON_ORDERS = 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 1 1 6 0H9z'
const ICON_CALENDAR = 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'
const ICON_INFO = 'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm0-11v5m0-8h.01'
const ICON_ALERT = 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01'

export interface OrdersPageProps {
  /** Provided by AppLayout for cross-page navigation */
  readonly onNavigate?: (pageId: PageId) => void
  /** Optional data options for testing or custom client injection */
  readonly dataOptions?: UseOrdersDataOptions
}

export function OrdersPage({ dataOptions }: OrdersPageProps) {
  const {
    mode,
    isLoading,
    error,
    isMissingConfig,
    isLive,
    kitchenName,
    snapshotTime,
    shift,
    rawOrders,
    filteredOrders,
    summary,
    searchQuery,
    statusFilter,
    channelFilter,
    sortField,
    sortDirection,
    selectedOrderId,
    selectedOrder,
    isCompletingOrder,
    completionError,
    markOrderCompleted,
    setSearchQuery,
    setStatusFilter,
    setChannelFilter,
    setSortField,
    setSortDirection,
    setSelectedOrderId,
    refetch,
    setMode
  } = useOrdersData(dataOptions)

  const [showPasteNotice, setShowPasteNotice] = useState(false)

  const isFiltered =
    searchQuery.trim().length > 0 || statusFilter !== 'all' || channelFilter !== 'all'

  const handleResetFilters = () => {
    setSearchQuery('')
    setStatusFilter('all')
    setChannelFilter('all')
  }

  return (
    <article className="orders-page" aria-labelledby="orders-title">
      {/* ── 1. Page Header ────────────────────────────────────────── */}
      <header className="orders-header">
        <div className="orders-header__left">
          <div className="orders-header__kicker-row">
            <span className="orders-header__kicker">{kitchenName}</span>
            <span className="orders-header__badge">Orders Pipeline</span>
          </div>

          <div className="orders-header__title-row">
            <NavIcon path={ICON_ORDERS} size={24} className="orders-header__title-icon" />
            <h1 id="orders-title" className="orders-header__title">
              Orders
            </h1>
          </div>

          <p className="orders-header__subtitle">
            Incoming kitchen orders, real-time status tracking, item breakdowns, and channel fulfilment.
          </p>
        </div>

        <div className="orders-header__right">
          <div className="orders-header__date-pill">
            <NavIcon path={ICON_CALENDAR} size={13} className="orders-header__cal-icon" />
            <span>{shift}</span>
          </div>

          {/* Live vs Demo Status Pill */}
          {isLive ? (
            <div className="orders-header__live-pill" title="Connected to live backend API">
              <span className="orders-header__live-dot" aria-hidden="true" />
              <span className="orders-header__live-label">Live Backend</span>
              <span className="orders-header__live-hint">Connected</span>
            </div>
          ) : (
            <div className="orders-header__demo-pill" title="Demo mode — simulated operational data">
              <span className="orders-header__demo-dot" aria-hidden="true" />
              <span className="orders-header__demo-label">Simulated</span>
              <span className="orders-header__demo-hint">Demo Mode</span>
            </div>
          )}

          {/* Mode Switcher Action */}
          <button
            type="button"
            className="orders-mode-btn"
            onClick={() => {
              if (mode === 'live') {
                setMode('demo')
              } else {
                setMode('live')
                void refetch()
              }
            }}
          >
            {mode === 'live' ? 'View Demo Data' : 'Connect Live Backend'}
          </button>

          <div
            className="orders-header__snapshot-time"
            title={isLive ? 'Client-side refresh timestamp' : 'Simulated benchmark timestamp'}
          >
            {isLive ? `Refreshed: ${snapshotTime}` : snapshotTime}
          </div>
        </div>
      </header>

      {/* ── 2. Notice: Missing Configuration in Demo Mode ──────────── */}
      {mode === 'demo' && isMissingConfig && (
        <div className="orders-banner orders-banner--info" role="region" aria-label="Configuration notice">
          <div className="orders-banner__content">
            <NavIcon path={ICON_INFO} size={15} />
            <strong className="orders-banner__title">Demo Mode Active:</strong>
            <span className="orders-banner__text">
              <code>VITE_API_KEY</code> is not configured in <code>frontend/.env</code>. Displaying simulated kitchen orders dataset per AGENTS.md Rule 9.
            </span>
          </div>
        </div>
      )}

      {/* ── 3. Notice: Live Mode Error Banner (No Silent Fallback) ─── */}
      {mode === 'live' && error && (
        <div className="orders-banner orders-banner--error" role="alert" aria-label="Backend error">
          <div className="orders-banner__content">
            <NavIcon path={ICON_ALERT} size={16} />
            <div className="orders-banner__error-details">
              <strong className="orders-banner__title">Failed to load orders from live backend:</strong>
              <span className="orders-banner__text">{error.message}</span>
            </div>
          </div>
          <button
            type="button"
            className="orders-banner__retry-btn"
            onClick={() => void refetch()}
            disabled={isLoading}
          >
            {isLoading ? 'Retrying...' : 'Retry Connection'}
          </button>
        </div>
      )}

      {/* ── 4. WhatsApp Order Intake Helper / Status Callout ────────── */}
      <div className="orders-intake-banner">
        <div className="orders-intake-banner__left">
          <span className="orders-intake-icon" aria-hidden="true">
            💬
          </span>
          <div>
            <strong className="orders-intake-title">
              WhatsApp Order Intake & Paste-to-Extract
            </strong>
            <p className="orders-intake-desc">
              Customer messages can be pasted to extract structured orders using Bedrock AI (Feature 8). Backend extraction endpoint (<code>POST /api/orders/extract</code>) is pending server implementation. Existing orders from all channels are listed below.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="orders-intake-btn"
          onClick={() => setShowPasteNotice(!showPasteNotice)}
        >
          {showPasteNotice ? 'Hide Info' : 'Intake Details'}
        </button>
      </div>

      {showPasteNotice && (
        <aside className="orders-paste-info-box" aria-label="WhatsApp intake details">
          <h4>How Order Intake Works:</h4>
          <ol>
            <li>Customer orders arriving via WhatsApp, Instagram, or direct call can be pasted as raw text.</li>
            <li>Bedrock AI extracts the dish names, portions, delivery deadline, and customer phone into a structured draft.</li>
            <li>The kitchen owner verifies and confirms the order with an explicit option number before it is added to the live schedule.</li>
          </ol>
        </aside>
      )}

      {/* ── 5. Summary Metrics Ribbon ──────────────────────────────── */}
      <OrdersSummaryCards
        summary={summary}
        isLoading={isLoading}
        isFiltered={isFiltered}
        activeFilterCount={filteredOrders.length}
      />

      {/* ── 6. Filter & Search Toolbar ─────────────────────────────── */}
      <OrdersFilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeStatus={statusFilter}
        onSelectStatus={setStatusFilter}
        activeChannel={channelFilter}
        onSelectChannel={setChannelFilter}
        sortField={sortField}
        onSortFieldChange={setSortField}
        sortDirection={sortDirection}
        onSortDirectionToggle={() =>
          setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
        }
        onRefresh={() => void refetch()}
        isLoading={isLoading}
        totalShown={filteredOrders.length}
        summary={summary}
        rawCount={rawOrders.length}
      />

      {/* ── 7. Orders Table & Mobile List ──────────────────────────── */}
      <OrdersTable
        orders={filteredOrders}
        onSelectOrder={(id) => setSelectedOrderId(id)}
        selectedOrderId={selectedOrderId}
        onResetFilters={handleResetFilters}
        isFiltered={isFiltered}
      />

      {/* ── 8. Order Detail Modal ──────────────────────────────────── */}
      <OrderDetailModal
        order={selectedOrder}
        onClose={() => setSelectedOrderId(null)}
        onMarkCompleted={markOrderCompleted}
        isCompleting={isCompletingOrder}
        completionError={completionError}
      />
    </article>
  )
}
