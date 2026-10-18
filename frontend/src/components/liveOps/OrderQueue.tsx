/* ============================================================
   src/components/liveOps/OrderQueue.tsx
   Live order queue — the primary focal point of the page.
   Structured table on desktop, card list on mobile.
   ============================================================ */

import { useState } from 'react'
import type { LiveOrder, OrderStatus, OrderUrgency } from '../../types/liveOperations'
import { NavIcon } from '../icons/NavIcon'
import './OrderQueue.css'

interface OrderQueueProps {
  readonly orders: readonly LiveOrder[]
  readonly isLive?: boolean
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  queued:     'Queued',
  prep:       'In Prep',
  plating:    'Plating',
  ready:      'Ready',
  dispatched: 'Dispatched',
}

const STATUS_ORDER: OrderStatus[] = ['plating', 'ready', 'prep', 'queued', 'dispatched']

const ICON_CLOCK = 'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm0-14v6l4 2'
const ICON_ALERT = 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01'

type FilterTab = 'all' | OrderStatus | 'partial' | 'delayed'

function urgencyClass(u: OrderUrgency): string {
  return u === 'critical' ? 'is-critical' : u === 'warning' ? 'is-warning' : ''
}

function formatDue(mins: number): string {
  if (mins < 0) return `${Math.abs(mins)}m overdue`
  if (mins === 0) return 'Due now'
  return `${mins}m`
}

export function OrderQueue({ orders, isLive = false }: OrderQueueProps) {
  const [filter, setFilter] = useState<FilterTab>('all')

  const hasPlating = orders.some(o => o.status === 'plating')
  const hasDispatched = orders.some(o => o.status === 'dispatched')
  const hasPartial = orders.some(o => o.rawStatus === 'partial')
  const hasDelayed = orders.some(o => o.rawStatus === 'delayed')

  const visible = filter === 'all'
    ? [...orders].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
    : filter === 'partial'
    ? orders.filter(o => o.rawStatus === 'partial')
    : filter === 'delayed'
    ? orders.filter(o => o.rawStatus === 'delayed')
    : orders.filter(o => o.status === filter)

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: 'all',        label: 'All',        count: orders.length },
    { key: 'prep',       label: 'In Prep',    count: orders.filter(o => o.status === 'prep').length },
    ...(hasPartial ? [{ key: 'partial' as const, label: 'Partial', count: orders.filter(o => o.rawStatus === 'partial').length }] : []),
    ...(hasPlating ? [{ key: 'plating' as const, label: 'Plating', count: orders.filter(o => o.status === 'plating').length }] : []),
    { key: 'ready',      label: 'Ready',      count: orders.filter(o => o.status === 'ready').length },
    { key: 'queued',     label: 'Queued',     count: orders.filter(o => o.status === 'queued').length },
    ...(hasDelayed ? [{ key: 'delayed' as const, label: 'Delayed', count: orders.filter(o => o.rawStatus === 'delayed').length }] : []),
    ...(hasDispatched ? [{ key: 'dispatched' as const, label: 'Dispatched', count: orders.filter(o => o.status === 'dispatched').length }] : []),
  ]

  return (
    <section className="order-queue" aria-labelledby="order-queue-title">
      <header className="order-queue__header">
        <div className="order-queue__titles">
          <div className="order-queue__badge-row">
            <span className="order-queue__badge">Order Pipeline</span>
            <span className={`order-queue__simulated ${isLive ? 'is-live' : ''}`}>
              {isLive ? 'Live Orders' : 'Simulated Orders'}
            </span>
          </div>
          <h2 id="order-queue-title" className="order-queue__title">
            Active Order Queue
          </h2>
          <p className="order-queue__subtitle">
            {isLive
              ? 'Real-time kitchen order queue from API (live data)'
              : 'Real-time prep tracking from receipt to dispatch (simulated data)'}
          </p>
        </div>

        {/* Urgency legend */}
        <div className="order-queue__legend" aria-label="Urgency indicators">
          <span className="order-queue__legend-item">
            <span className="oq-dot is-critical" aria-hidden="true" />Critical
          </span>
          <span className="order-queue__legend-item">
            <span className="oq-dot is-warning" aria-hidden="true" />Near deadline
          </span>
          <span className="order-queue__legend-item">
            <span className="oq-dot" aria-hidden="true" />Normal
          </span>
        </div>
      </header>

      {/* Status filter tabs */}
      <div className="order-queue__tabs" role="tablist" aria-label="Filter orders by status">
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={filter === t.key}
            className={`oq-tab ${filter === t.key ? 'is-active' : ''}`}
            onClick={() => setFilter(t.key)}
          >
            {t.label}
            {t.count > 0 && (
              <span className="oq-tab__count">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Desktop table */}
      <div className="order-queue__table-wrap">
        <table className="oq-table" aria-label="Order queue">
          <thead>
            <tr>
              <th scope="col" className="oq-col--ref">Order</th>
              <th scope="col" className="oq-col--items">Items</th>
              <th scope="col" className="oq-col--channel">Channel</th>
              <th scope="col" className="oq-col--status">Status</th>
              <th scope="col" className="oq-col--progress">Progress</th>
              <th scope="col" className="oq-col--due">Due / ETA</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="oq-empty-cell">
                  <div className="oq-empty-message">
                    <NavIcon path={ICON_CLOCK} size={18} className="oq-empty-icon" />
                    <span>No orders matching this filter</span>
                  </div>
                </td>
              </tr>
            ) : (
              visible.map(order => {
                const urg = urgencyClass(order.urgency)
                const isOverdue = order.minutesUntilDue < 0
                return (
                  <tr key={order.id} className={`oq-row ${urg}`}>
                    <td className="oq-cell--ref">
                      <div className="oq-ref-wrap">
                        {order.urgency !== 'normal' && (
                          <NavIcon
                            path={ICON_ALERT}
                            size={13}
                            className={`oq-alert-icon ${urg}`}
                          />
                        )}
                        <span className="oq-ref">{order.ref}</span>
                      </div>
                      <span className="oq-channel-ref">{order.channelRef}</span>
                    </td>

                    <td className="oq-cell--items">
                      <ul className="oq-items-list">
                        {order.items.map(item => (
                          <li key={item.name}>
                            <span className="oq-qty">{item.qty}×</span>
                            {item.name}
                          </li>
                        ))}
                      </ul>
                    </td>

                    <td className="oq-cell--channel">
                      <span className="oq-channel">{order.channel}</span>
                    </td>

                    <td className="oq-cell--status">
                      {order.rawStatus === 'partial' ? (
                        <span className="oq-status-pill oq-status--partial" title="Partial fulfillment — portions missing">
                          Partial
                        </span>
                      ) : order.rawStatus === 'delayed' ? (
                        <span className="oq-status-pill oq-status--delayed" title="Order delayed past schedule">
                          Delayed
                        </span>
                      ) : (
                        <span className={`oq-status-pill oq-status--${order.status}`}>
                          {STATUS_LABELS[order.status]}
                        </span>
                      )}
                    </td>

                    <td className="oq-cell--progress">
                      {order.status === 'dispatched' ? (
                        <span className="oq-dispatched-note">Completed</span>
                      ) : (
                        <div className="oq-progress-wrap">
                          <div className="oq-progress-track">
                            <div
                              className={`oq-progress-fill ${urg || 'is-normal'}`}
                              style={{ width: `${order.progressPct}%` }}
                            />
                          </div>
                          <span className="oq-pct">{order.progressPct}%</span>
                        </div>
                      )}
                    </td>

                    <td className="oq-cell--due">
                      <div className={`oq-due-wrap ${isOverdue ? 'is-overdue' : ''} ${urg}`}>
                        <NavIcon path={ICON_CLOCK} size={12} className="oq-due-icon" />
                        <span className="oq-due-time">{order.dueTime}</span>
                      </div>
                      <span className={`oq-due-delta ${isOverdue ? 'is-overdue' : ''} ${urg}`}>
                        {formatDue(order.minutesUntilDue)}
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile card list (CSS shows/hides per breakpoint) */}
      <div className="order-queue__mobile-list" role="list">
        {visible.length === 0 ? (
          <div className="oq-mobile-empty">
            <span>No orders matching this filter</span>
          </div>
        ) : (
          visible.map(order => {
            const urg = urgencyClass(order.urgency)
            const isOverdue = order.minutesUntilDue < 0
            return (
              <div key={order.id} className={`oq-mobile-card ${urg}`} role="listitem">
                <div className="oq-mobile-card__top">
                  <div className="oq-ref-wrap">
                    {order.urgency !== 'normal' && (
                      <NavIcon path={ICON_ALERT} size={13} className={`oq-alert-icon ${urg}`} />
                    )}
                    <span className="oq-ref">{order.ref}</span>
                  </div>
                  {order.rawStatus === 'partial' ? (
                    <span className="oq-status-pill oq-status--partial" title="Partial fulfillment — portions missing">
                      Partial
                    </span>
                  ) : order.rawStatus === 'delayed' ? (
                    <span className="oq-status-pill oq-status--delayed" title="Order delayed past schedule">
                      Delayed
                    </span>
                  ) : (
                    <span className={`oq-status-pill oq-status--${order.status}`}>
                      {STATUS_LABELS[order.status]}
                    </span>
                  )}
                </div>

                <div className="oq-mobile-card__items">
                  {order.items.map(item => (
                    <span key={item.name} className="oq-mobile-item">
                      {item.qty}× {item.name}
                    </span>
                  ))}
                </div>

                <div className="oq-mobile-card__meta">
                  <span className="oq-channel">{order.channel} · {order.channelRef}</span>
                  <div className={`oq-due-wrap ${isOverdue ? 'is-overdue' : ''} ${urg}`}>
                    <NavIcon path={ICON_CLOCK} size={11} className="oq-due-icon" />
                    <span className="oq-due-time">{order.dueTime}</span>
                    <span className={`oq-due-delta ${isOverdue ? 'is-overdue' : ''}`}>
                      ({formatDue(order.minutesUntilDue)})
                    </span>
                  </div>
                </div>

                {order.status !== 'dispatched' && (
                  <div className="oq-progress-wrap">
                    <div className="oq-progress-track">
                      <div
                        className={`oq-progress-fill ${urg || 'is-normal'}`}
                        style={{ width: `${order.progressPct}%` }}
                      />
                    </div>
                    <span className="oq-pct">{order.progressPct}%</span>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
