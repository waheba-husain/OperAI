/* ============================================================
   frontend/src/components/orders/OrdersFilterToolbar.tsx
   OperAI / Cloud Kitchen Rescue — Orders Filter & Search Toolbar
   ============================================================ */

import type { OrderChannelDTO } from '../../types/dto.ts'
import type {
  OrderFilterTab,
  OrderSortDirection,
  OrderSortField,
  OrdersSummaryMetrics
} from '../../types/orders.ts'
import './OrdersFilterToolbar.css'

export interface OrdersFilterToolbarProps {
  readonly searchQuery: string
  readonly onSearchChange: (query: string) => void
  readonly activeStatus: OrderFilterTab
  readonly onSelectStatus: (status: OrderFilterTab) => void
  readonly activeChannel: 'all' | OrderChannelDTO
  readonly onSelectChannel: (channel: 'all' | OrderChannelDTO) => void
  readonly sortField: OrderSortField
  readonly onSortFieldChange: (field: OrderSortField) => void
  readonly sortDirection: OrderSortDirection
  readonly onSortDirectionToggle: () => void
  readonly onRefresh: () => void
  readonly isLoading: boolean
  readonly totalShown: number
  readonly summary: OrdersSummaryMetrics
  readonly rawCount: number
}

interface StatusTabOption {
  readonly id: OrderFilterTab
  readonly label: string
}

const STATUS_TABS: readonly StatusTabOption[] = [
  { id: 'all', label: 'All Orders' },
  { id: 'new', label: 'New' },
  { id: 'planned', label: 'Planned' },
  { id: 'in_progress', label: 'In Prep' },
  { id: 'delayed', label: 'Delayed' },
  { id: 'partial', label: 'Partial' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' }
]

const CHANNELS: readonly { id: 'all' | OrderChannelDTO; label: string }[] = [
  { id: 'all', label: 'All Channels' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'swiggy', label: 'Swiggy' },
  { id: 'zomato', label: 'Zomato' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'direct', label: 'Direct Call' }
]

export function OrdersFilterToolbar({
  searchQuery,
  onSearchChange,
  activeStatus,
  onSelectStatus,
  activeChannel,
  onSelectChannel,
  sortField,
  onSortFieldChange,
  sortDirection,
  onSortDirectionToggle,
  onRefresh,
  isLoading,
  totalShown,
  summary,
  rawCount
}: OrdersFilterToolbarProps) {
  // Compute count per status tab from summary
  const getTabCount = (tabId: OrderFilterTab): number => {
    if (tabId === 'all') return rawCount
    if (tabId === 'delayed') return summary.delayedOrders
    if (tabId === 'completed') return summary.completedOrders
    if (tabId === 'cancelled') return summary.cancelledOrders
    // Return approximate for others if needed or 0
    return 0
  }

  return (
    <div className="orders-filter-toolbar" role="toolbar" aria-label="Orders filters and search">
      {/* ── Top Row: Search Input + Channel Filter + Sort + Refresh ── */}
      <div className="orders-filter-top">
        {/* Search Input */}
        <div className="orders-search-box">
          <span className="orders-search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            type="search"
            className="orders-search-input"
            placeholder="Search by customer, #ORD-..., dish..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search orders"
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              className="orders-search-clear"
              onClick={() => onSearchChange('')}
              aria-label="Clear search query"
            >
              ✕
            </button>
          )}
        </div>

        {/* Channel Filter Selector */}
        <div className="orders-select-group">
          <label htmlFor="channel-select" className="orders-select-label">
            Channel:
          </label>
          <select
            id="channel-select"
            className="orders-select"
            value={activeChannel}
            onChange={(e) => onSelectChannel(e.target.value as 'all' | OrderChannelDTO)}
          >
            {CHANNELS.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.label}
              </option>
            ))}
          </select>
        </div>

        {/* Sort Controls */}
        <div className="orders-select-group">
          <label htmlFor="sort-select" className="orders-select-label">
            Sort by:
          </label>
          <select
            id="sort-select"
            className="orders-select"
            value={sortField}
            onChange={(e) => onSortFieldChange(e.target.value as OrderSortField)}
          >
            <option value="deadline">Deadline</option>
            <option value="totalAmount">Order Value (₹)</option>
            <option value="customerName">Customer Name</option>
            <option value="status">Status</option>
          </select>

          <button
            type="button"
            className="orders-sort-dir-btn"
            onClick={onSortDirectionToggle}
            title={sortDirection === 'asc' ? 'Ascending (click to sort descending)' : 'Descending (click to sort ascending)'}
            aria-label={`Sort direction: ${sortDirection}`}
          >
            {sortDirection === 'asc' ? '↑' : '↓'}
          </button>
        </div>

        {/* Refresh Action */}
        <button
          type="button"
          className="orders-refresh-btn"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label={isLoading ? 'Refreshing orders...' : 'Refresh orders'}
        >
          <span className={isLoading ? 'orders-spin' : ''} aria-hidden="true">
            🔄
          </span>
          <span>{isLoading ? 'Syncing...' : 'Refresh'}</span>
          <span className="orders-refresh-count">({totalShown})</span>
        </button>
      </div>

      {/* ── Bottom Row: Status Filter Tabs ── */}
      <div className="orders-filter-pills" role="tablist" aria-label="Filter by order status">
        {STATUS_TABS.map((tab) => {
          const isActive = activeStatus === tab.id
          const count = getTabCount(tab.id)
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`orders-filter-pill ${isActive ? 'orders-filter-pill--active' : ''}`}
              onClick={() => onSelectStatus(tab.id)}
            >
              <span>{tab.label}</span>
              {count > 0 && <span className="orders-tab-count"> ({count})</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
