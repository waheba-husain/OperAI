/* ============================================================
   frontend/src/components/orders/OrdersTable.tsx
   OperAI / Cloud Kitchen Rescue — Orders Table & Mobile List
   ============================================================ */

import type { OrderViewModel } from '../../types/orders.ts'
import { formatDueLabel } from '../../api/adapters/orderAdapter.ts'
import './OrdersTable.css'

export interface OrdersTableProps {
  readonly orders: readonly OrderViewModel[]
  readonly onSelectOrder: (id: string) => void
  readonly selectedOrderId: string | null
  readonly onResetFilters?: () => void
  readonly isFiltered?: boolean
}

function getStatusClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'orders-badge--success'
    case 'in_progress':
      return 'orders-badge--info'
    case 'delayed':
      return 'orders-badge--warning'
    case 'partial':
      return 'orders-badge--warning'
    case 'new':
      return 'orders-badge--accent'
    case 'planned':
      return 'orders-badge--neutral'
    case 'cancelled':
      return 'orders-badge--muted'
    default:
      return 'orders-badge--neutral'
  }
}

function getChannelBadgeClass(channel: string): string {
  switch (channel) {
    case 'whatsapp':
      return 'orders-channel--whatsapp'
    case 'swiggy':
      return 'orders-channel--swiggy'
    case 'zomato':
      return 'orders-channel--zomato'
    case 'instagram':
      return 'orders-channel--instagram'
    case 'direct':
      return 'orders-channel--direct'
    default:
      return 'orders-channel--default'
  }
}

export function OrdersTable({
  orders,
  onSelectOrder,
  selectedOrderId,
  onResetFilters,
  isFiltered = false
}: OrdersTableProps) {
  if (orders.length === 0) {
    return (
      <div className="orders-empty-state" role="region" aria-label="No orders found">
        <div className="orders-empty-icon" aria-hidden="true">
          📦
        </div>
        <h3 className="orders-empty-title">No orders found</h3>
        <p className="orders-empty-desc">
          {isFiltered
            ? 'No orders match your active search or filter criteria. Try clearing search or resetting status.'
            : 'There are currently no orders in the kitchen pipeline for this date.'}
        </p>
        {isFiltered && onResetFilters && (
          <button
            type="button"
            className="orders-empty-reset-btn"
            onClick={onResetFilters}
          >
            Reset Filters
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="orders-table-container">
      {/* ── Desktop Table ────────────────────────────────────── */}
      <div className="orders-table-wrapper">
        <table className="orders-table" aria-label="Kitchen Orders Pipeline">
          <thead>
            <tr>
              <th scope="col" className="col-ref">Ref / ID</th>
              <th scope="col" className="col-customer">Customer</th>
              <th scope="col" className="col-channel">Channel</th>
              <th scope="col" className="col-items">Items Breakdown</th>
              <th scope="col" className="col-amount">Total</th>
              <th scope="col" className="col-status">Status</th>
              <th scope="col" className="col-deadline">Deadline (IST)</th>
              <th scope="col" className="col-action">Action</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const isSelected = selectedOrderId === order.id
              const isOverdue =
                order.status !== 'completed' &&
                order.status !== 'cancelled' &&
                order.deadlineStatus === 'overdue'
              const isAttention =
                order.status !== 'completed' &&
                order.status !== 'cancelled' &&
                (order.status === 'delayed' || isOverdue)

              return (
                <tr
                  key={order.id}
                  className={`orders-table-row ${isSelected ? 'orders-table-row--selected' : ''} ${
                    isAttention ? 'orders-table-row--attention' : ''
                  }`}
                  onClick={() => onSelectOrder(order.id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectOrder(order.id)
                    }
                  }}
                  role="button"
                  aria-pressed={isSelected}
                  aria-label={`Order ${order.ref} for ${order.customerName}`}
                >
                  {/* Ref & ID */}
                  <td className="col-ref">
                    <span className="orders-ref-text">{order.ref}</span>
                    <span className="orders-id-subtext" title={order.id}>
                      {order.id.slice(0, 8)}...
                    </span>
                  </td>

                  {/* Customer Name */}
                  <td className="col-customer">
                    <span className="orders-customer-name">{order.customerName}</span>
                    <span className="orders-items-count-badge">
                      {order.itemsCount} portion{order.itemsCount === 1 ? '' : 's'}
                    </span>
                  </td>

                  {/* Channel */}
                  <td className="col-channel">
                    <span className={`orders-channel-badge ${getChannelBadgeClass(order.channel)}`}>
                      {order.channelLabel}
                    </span>
                  </td>

                  {/* Items summary */}
                  <td className="col-items">
                    <ul className="orders-items-summary-list">
                      {order.items.slice(0, 3).map((item) => (
                        <li key={item.menuItemId || item.name} className="orders-item-line">
                          <span className="orders-item-qty">{item.quantity}×</span>
                          <span className="orders-item-name">{item.name}</span>
                        </li>
                      ))}
                      {order.items.length > 3 && (
                        <li className="orders-item-more">
                          +{order.items.length - 3} more item{order.items.length - 3 === 1 ? '' : 's'}
                        </li>
                      )}
                    </ul>
                  </td>

                  {/* Amount */}
                  <td className="col-amount">
                    <span className="orders-total-amount">{order.formattedTotalAmount}</span>
                  </td>

                  {/* Status */}
                  <td className="col-status">
                    <span className={`orders-status-pill ${getStatusClass(order.status)}`}>
                      {order.statusLabel}
                    </span>
                  </td>

                  {/* Deadline & Urgency */}
                  <td className="col-deadline">
                    <div className="orders-deadline-box">
                      <span className="orders-deadline-time">
                        🕒 {order.formattedDeadlineTime}
                      </span>
                      <span
                        className={`orders-deadline-delta ${
                          isOverdue ? 'orders-deadline-delta--overdue' : ''
                        }`}
                      >
                        {formatDueLabel(order.minutesUntilDue, order.status)}
                      </span>
                    </div>
                  </td>

                  {/* Action */}
                  <td className="col-action" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="orders-action-btn"
                      onClick={() => onSelectOrder(order.id)}
                      aria-label={`View details for ${order.ref}`}
                    >
                      Details →
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Mobile Cards List ─────────────────────────────────── */}
      <div className="orders-mobile-list" role="list">
        {orders.map((order) => {
          const isSelected = selectedOrderId === order.id
          const isOverdue =
            order.status !== 'completed' &&
            order.status !== 'cancelled' &&
            order.deadlineStatus === 'overdue'
          const isAttention =
            order.status !== 'completed' &&
            order.status !== 'cancelled' &&
            (order.status === 'delayed' || isOverdue)

          return (
            <div
              key={order.id}
              className={`orders-mobile-card ${isSelected ? 'orders-mobile-card--selected' : ''} ${
                isAttention ? 'orders-mobile-card--attention' : ''
              }`}
              onClick={() => onSelectOrder(order.id)}
              role="listitem"
            >
              <div className="orders-mobile-card__header">
                <div className="orders-mobile-card__ref-wrap">
                  <span className="orders-ref-text">{order.ref}</span>
                  <span className={`orders-channel-badge ${getChannelBadgeClass(order.channel)}`}>
                    {order.channelLabel}
                  </span>
                </div>
                <span className={`orders-status-pill ${getStatusClass(order.status)}`}>
                  {order.statusLabel}
                </span>
              </div>

              <div className="orders-mobile-card__body">
                <div className="orders-mobile-customer-row">
                  <span className="orders-customer-name">{order.customerName}</span>
                  <span className="orders-total-amount">{order.formattedTotalAmount}</span>
                </div>

                <div className="orders-mobile-items-wrap">
                  {order.items.map((item) => (
                    <span key={item.menuItemId || item.name} className="orders-mobile-item-chip">
                      {item.quantity}× {item.name}
                    </span>
                  ))}
                </div>

                <div className="orders-mobile-footer">
                  <span className="orders-deadline-time">
                    🕒 Due {order.formattedDeadlineTime} (
                    <span className={isOverdue ? 'orders-deadline-delta--overdue' : ''}>
                      {formatDueLabel(order.minutesUntilDue, order.status)}
                    </span>
                    )
                  </span>
                  <button
                    type="button"
                    className="orders-mobile-view-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectOrder(order.id)
                    }}
                  >
                    Details →
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
