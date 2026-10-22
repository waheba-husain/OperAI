/* ============================================================
   frontend/src/components/orders/OrderDetailModal.tsx
   OperAI / Cloud Kitchen Rescue — Order Detail Modal Dialog
   ============================================================ */

import { useEffect, useRef } from 'react'
import type { OrderViewModel } from '../../types/orders.ts'
import './OrderDetailModal.css'

export interface OrderDetailModalProps {
  readonly order: OrderViewModel | null
  readonly onClose: () => void
  readonly onMarkCompleted?: (orderId: string) => Promise<boolean | void> | void
  readonly isCompleting?: boolean
  readonly completionError?: Error | null
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

export function OrderDetailModal({
  order,
  onClose,
  onMarkCompleted,
  isCompleting = false,
  completionError = null
}: OrderDetailModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)

  // ESC key listener
  useEffect(() => {
    if (!order) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [order, onClose])

  if (!order) return null

  // WhatsApp wa.me link generation (PRD §3.5 customer communication)
  const phone = order.customerPhone?.replace(/\D/g, '') || ''
  const whatsappUrl =
    phone.length > 0
      ? `https://wa.me/${phone}?text=${encodeURIComponent(
          `Hi ${order.customerName}, regarding your order ${order.ref} from OperAI Kitchen:`
        )}`
      : null

  const isOverdue =
    order.status !== 'completed' &&
    order.status !== 'cancelled' &&
    order.deadlineStatus === 'overdue'
  const isAttention =
    order.status !== 'completed' &&
    order.status !== 'cancelled' &&
    (order.status === 'delayed' || isOverdue)

  const canComplete =
    order.status !== 'completed' &&
    order.status !== 'cancelled' &&
    Boolean(onMarkCompleted)

  const handleComplete = async () => {
    if (!onMarkCompleted || isCompleting) return
    await onMarkCompleted(order.id)
  }

  return (
    <div
      className="order-modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="order-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-modal-title"
        onClick={(e) => e.stopPropagation()}
        ref={dialogRef}
      >
        {/* ── Modal Header ────────────────────────────────────── */}
        <header className="order-modal-header">
          <div className="order-modal-header__info">
            <div className="order-modal-ref-row">
              <span className="order-modal-ref">{order.ref}</span>
              <span className={`orders-status-pill ${getStatusClass(order.status)}`}>
                {order.statusLabel}
              </span>
              <span className="order-modal-channel-tag">{order.channelLabel}</span>
              <span
                className={`order-modal-source-tag ${
                  order.dataSource === 'verified' ? 'order-modal-source-tag--live' : ''
                }`}
              >
                {order.dataSource === 'verified' ? 'Live API Data' : 'Simulated Data'}
              </span>
            </div>
            <h2 id="order-modal-title" className="order-modal-title">
              {order.customerName}
            </h2>
          </div>

          <button
            type="button"
            className="order-modal-close-btn"
            onClick={onClose}
            aria-label="Close order details modal"
          >
            ✕
          </button>
        </header>

        {/* ── Modal Body ──────────────────────────────────────── */}
        <div className="order-modal-body">
          {/* Metadata Grid */}
          <div className="order-modal-meta-grid">
            <div className="order-modal-meta-item">
              <span className="order-modal-meta-label">Canonical Order ID</span>
              <span className="order-modal-meta-val order-modal-mono">{order.id}</span>
            </div>

            <div className="order-modal-meta-item">
              <span className="order-modal-meta-label">Delivery / Pickup Deadline</span>
              <span
                className={`order-modal-meta-val ${
                  isAttention ? 'order-modal-meta-val--attention' : ''
                }`}
              >
                🕒 {order.formattedDeadlineTime} · {order.formattedDeadlineDate}
                {isOverdue && ' (Deadline Overdue)'}
                {!isOverdue && order.status === 'delayed' && ' (Late Risk / Delayed)'}
              </span>
            </div>

            <div className="order-modal-meta-item">
              <span className="order-modal-meta-label">Intake Channel</span>
              <span className="order-modal-meta-val">{order.channelLabel}</span>
            </div>

            <div className="order-modal-meta-item">
              <span className="order-modal-meta-label">Total Portions</span>
              <span className="order-modal-meta-val">
                {order.itemsCount} portion{order.itemsCount === 1 ? '' : 's'} across {order.items.length} dish{order.items.length === 1 ? '' : 'es'}
              </span>
            </div>
          </div>

          {/* Itemized Line Items Table */}
          <section className="order-modal-items-section" aria-label="Itemized order dishes">
            <h3 className="order-modal-section-title">Itemized Order Breakdown</h3>
            <div className="order-modal-table-wrap">
              <table className="order-modal-table">
                <thead>
                  <tr>
                    <th scope="col">Dish Item</th>
                    <th scope="col" className="text-right">Qty</th>
                    <th scope="col" className="text-right">Unit Price</th>
                    <th scope="col" className="text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.menuItemId || item.name}>
                      <td className="order-modal-dish-cell">
                        <span className="order-modal-dish-name">{item.name}</span>
                        {item.menuItemId && (
                          <span className="order-modal-dish-id">{item.menuItemId}</span>
                        )}
                      </td>
                      <td className="text-right font-semibold">{item.quantity}</td>
                      <td className="text-right font-mono">{item.formattedUnitPrice}</td>
                      <td className="text-right font-mono font-semibold">
                        {item.formattedSubtotal}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="order-modal-total-row">
                    <td colSpan={3} className="order-modal-total-label">
                      Order Total
                    </td>
                    <td className="order-modal-total-val text-right font-mono">
                      {order.formattedTotalAmount}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* Customer Communication & Notes */}
          <section className="order-modal-notes-section">
            <h3 className="order-modal-section-title">Customer Notification</h3>
            {whatsappUrl ? (
              <div className="order-modal-whatsapp-box">
                <div className="order-modal-whatsapp-text">
                  <strong>WhatsApp Customer Contact Available:</strong>
                  <p>Send order confirmation or preparation updates directly via WhatsApp.</p>
                </div>
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="order-modal-whatsapp-link"
                >
                  Open WhatsApp Draft ↗
                </a>
              </div>
            ) : (
              <p className="order-modal-channel-note">
                Order received via <strong>{order.channelLabel}</strong>. Customer communication is handled through the delivery partner platform or direct phone contact.
              </p>
            )}
          </section>
        </div>

        {/* ── Modal Footer ────────────────────────────────────── */}
        <footer className="order-modal-footer">
          <div className="order-modal-footer__left">
            <span className="order-modal-footer-hint">
              Press <kbd>Esc</kbd> or click outside to dismiss.
            </span>
            {completionError && (
              <span className="order-modal-error-text" role="alert">
                ⚠️ {completionError.message}
              </span>
            )}
          </div>

          <div className="order-modal-footer__actions">
            {canComplete && (
              <button
                type="button"
                className="order-modal-complete-action-btn"
                onClick={handleComplete}
                disabled={isCompleting}
                aria-busy={isCompleting}
              >
                {isCompleting ? (
                  <>
                    <span className="order-modal-spinner" aria-hidden="true" />
                    <span>Completing...</span>
                  </>
                ) : (
                  <>
                    <span>✓</span>
                    <span>Mark as Completed</span>
                  </>
                )}
              </button>
            )}
            {order.status === 'completed' && (
              <span className="order-modal-completed-badge">
                ✓ Order Completed
              </span>
            )}
            <button
              type="button"
              className="order-modal-close-action-btn"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
