/* ============================================================
   src/components/overview/PerformanceChart.tsx
   Accessible, lightweight, dependency-free SVG Performance Chart.
   Renders hourly kitchen revenue and order volume trends with
   light/dark theme support via CSS variables, interactive hover
   tooltips, and accessible semantic data representations.
   ============================================================ */

import { useState } from 'react'
import type { HourlyPerformancePoint } from '../../types/overview'
import './PerformanceChart.css'

interface PerformanceChartProps {
  data: readonly HourlyPerformancePoint[]
}

const SEVEN_DAY_DATA: readonly HourlyPerformancePoint[] = [
  // Illustrative weekly demo pacing data — simulated INR benchmarks per AGENTS.md rule 9
  { time: 'Mon', revenue: 246000, orders: 112 },
  { time: 'Tue', revenue: 275000, orders: 125 },
  { time: 'Wed', revenue: 260000, orders: 118 },
  { time: 'Thu', revenue: 286000, orders: 130 },
  { time: 'Fri', revenue: 318800, orders: 142 },
  { time: 'Sat', revenue: 392000, orders: 178, peak: true },
  { time: 'Sun', revenue: 340000, orders: 154 },
]

export function PerformanceChart({ data }: PerformanceChartProps) {
  const [viewMode, setViewMode] = useState<'hourly' | 'weekly'>('hourly')
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const rawPoints = viewMode === 'hourly' ? data : SEVEN_DAY_DATA
  const activePoints = (rawPoints || []).map(p => ({
    time: p.time || '—',
    revenue: typeof p.revenue === 'number' && !isNaN(p.revenue) ? Math.max(0, p.revenue) : 0,
    orders: typeof p.orders === 'number' && !isNaN(p.orders) ? Math.max(0, p.orders) : 0,
    peak: Boolean(p.peak),
  }))

  const isEmpty = activePoints.length === 0
  const isSingle = activePoints.length === 1

  // SVG chart dimensions
  const width = 640
  const height = 210
  const padLeft = 46
  const padRight = 24
  const padTop = 24
  const padBottom = 32

  const plotWidth = width - padLeft - padRight
  const plotHeight = height - padTop - padBottom

  const maxRevenue = isEmpty ? 1000 : Math.max(...activePoints.map(p => p.revenue), 1000)
  const yCeil = viewMode === 'hourly' ? 1000 : 5000
  const maxVal = Math.max(maxRevenue * 1.15, yCeil)

  // Map data to coordinates safely without division by zero
  const coords = activePoints.map((p, i) => {
    const x = isSingle
      ? padLeft + plotWidth / 2
      : padLeft + (i / (activePoints.length - 1)) * plotWidth
    const y = padTop + plotHeight - (p.revenue / maxVal) * plotHeight
    return { ...p, x, y, index: i }
  })

  // Generate SVG path for line and area fill (only if 2+ points)
  const pathD = coords.length > 1
    ? coords.reduce((acc, pt, i) => {
        return i === 0 ? `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}` : `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`
      }, '')
    : ''

  const areaD = coords.length > 1
    ? `${pathD} L ${coords[coords.length - 1].x.toFixed(1)} ${(padTop + plotHeight).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(padTop + plotHeight).toFixed(1)} Z`
    : ''

  // Y-axis grid increments (4 lines)
  const yTicks = [0, maxVal * 0.33, maxVal * 0.66, maxVal]

  const activePoint = hoveredIndex !== null && hoveredIndex < coords.length ? coords[hoveredIndex] : null

  // Derive the peak point from data safely
  const peakPoint = activePoints.length > 0
    ? activePoints.reduce((best, p) => p.revenue > best.revenue ? p : best, activePoints[0])
    : null

  // Derive order bar scaling safely
  const highestOrders = isEmpty ? 1 : Math.max(...activePoints.map(p => p.orders), 1)
  const baselineMaxOrders = viewMode === 'hourly' ? 40 : 200
  const maxOrders = Math.max(highestOrders * 1.1, baselineMaxOrders)

  // INR formatter per backend spec (money is INR)
  const formatINR = (value: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)

  const accessibleChartLabel = isEmpty
    ? 'Kitchen performance chart (no data available)'
    : `Kitchen performance chart showing ${viewMode === 'hourly' ? 'hourly pacing trends' : '7-day revenue trend'}`

  return (
    <section className="perf-chart-card" aria-labelledby="perf-chart-title">
      <header className="perf-chart-card__header">
        <div className="perf-chart-card__titles">
          <div className="perf-chart-card__badge-row">
            <span className="perf-chart-card__badge">Performance Analytics</span>
            <span className="perf-chart-card__simulated">Simulated Data</span>
          </div>
          <h2 id="perf-chart-title" className="perf-chart-card__title">
            Revenue & Order Throughput
          </h2>
          <p className="perf-chart-card__subtitle">
            Pacing trajectory comparing gross takings (₹ INR) with order volume
          </p>
        </div>

        {/* View mode toggle */}
        <div className="perf-chart-card__toggles" role="tablist" aria-label="Performance view mode">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'hourly'}
            className={`perf-chart-toggle-btn ${viewMode === 'hourly' ? 'is-active' : ''}`}
            onClick={() => {
              setViewMode('hourly')
              setHoveredIndex(null)
            }}
          >
            Today (Hourly)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'weekly'}
            className={`perf-chart-toggle-btn ${viewMode === 'weekly' ? 'is-active' : ''}`}
            onClick={() => {
              setViewMode('weekly')
              setHoveredIndex(null)
            }}
          >
            7-Day Pacing
          </button>
        </div>
      </header>

      {/* Legend & Stats Quick Bar */}
      <div className="perf-chart-summary-bar">
        <div className="perf-chart-legend">
          <div className="perf-chart-legend-item">
            <span className="perf-legend-indicator is-revenue" aria-hidden="true" />
            <span className="perf-legend-label">Revenue (₹ INR)</span>
          </div>
          <div className="perf-chart-legend-item">
            <span className="perf-legend-indicator is-orders" aria-hidden="true" />
            <span className="perf-legend-label">Orders (Count)</span>
          </div>
        </div>

        {peakPoint && (
          <div className="perf-chart-peak-callout">
            <span className="perf-peak-label">Peak:</span>
            <strong className="perf-peak-value">{peakPoint.time} · {formatINR(peakPoint.revenue)} · {peakPoint.orders} orders</strong>
          </div>
        )}
      </div>

      {/* Interactive SVG Chart Container or Empty State */}
      {isEmpty ? (
        <div className="perf-chart-empty-state" role="status">
          <p className="perf-chart-empty-text">No performance data available for this period.</p>
          <span className="perf-chart-empty-sub">Simulated telemetry dataset is empty</span>
        </div>
      ) : (
        <div className="perf-chart-svg-wrap">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="perf-svg"
            role="img"
            aria-label={accessibleChartLabel}
          >
            <defs>
              <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.28" />
                <stop offset="90%" stopColor="var(--color-primary)" stopOpacity="0.01" />
              </linearGradient>
              <linearGradient id="orderBarGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-warm-accent)" stopOpacity="0.85" />
                <stop offset="100%" stopColor="var(--color-warm-accent)" stopOpacity="0.3" />
              </linearGradient>
            </defs>

            {/* Gridlines & Y-Axis Labels */}
            {yTicks.map((val, i) => {
              const yPos = padTop + plotHeight - (val / maxVal) * plotHeight
              return (
                <g key={`ytick-${i}`} className="perf-grid-group">
                  <line
                    x1={padLeft}
                    y1={yPos}
                    x2={width - padRight}
                    y2={yPos}
                    className="perf-grid-line"
                  />
                  <text
                    x={padLeft - 8}
                    y={yPos + 4}
                    textAnchor="end"
                    className="perf-axis-label"
                  >
                    {val >= 1000 ? `${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k` : Math.round(val)}
                  </text>
                </g>
              )
            })}

            {/* Secondary Order Volume Columns (subtle background pillars) */}
            {coords.map(pt => {
              const barWidth = viewMode === 'hourly' ? 14 : 22
              const barHeight = (pt.orders / maxOrders) * (plotHeight * 0.72)
              const barY = padTop + plotHeight - barHeight
              const isHovered = hoveredIndex === pt.index

              return (
                <rect
                  key={`bar-${pt.time}`}
                  x={pt.x - barWidth / 2}
                  y={barY}
                  width={barWidth}
                  height={barHeight}
                  rx={2}
                  className={`perf-order-bar ${isHovered ? 'is-hovered' : ''}`}
                  fill="url(#orderBarGradient)"
                />
              )
            })}

            {/* Area under revenue curve */}
            {areaD && <path d={areaD} fill="url(#revenueGradient)" />}

            {/* Revenue Polyline */}
            {pathD && (
              <path
                d={pathD}
                fill="none"
                className="perf-line-path"
                stroke="var(--color-primary)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Data Points */}
            {coords.map(pt => {
              const isHovered = hoveredIndex === pt.index
              return (
                <g key={`pt-${pt.time}`}>
                  {/* Active vertical hover guideline */}
                  {isHovered && (
                    <line
                      x1={pt.x}
                      y1={padTop}
                      x2={pt.x}
                      y2={padTop + plotHeight}
                      className="perf-hover-guideline"
                      strokeDasharray="3 3"
                    />
                  )}

                  {/* Point circle */}
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={isHovered ? 6 : pt.peak ? 4.5 : 3.5}
                    className={`perf-data-dot ${pt.peak ? 'is-peak' : ''} ${isHovered ? 'is-active' : ''}`}
                  />

                  {/* X-axis tick label */}
                  <text
                    x={pt.x}
                    y={height - 10}
                    textAnchor="middle"
                    className={`perf-x-label ${isHovered ? 'is-hovered' : ''}`}
                  >
                    {pt.time}
                  </text>

                  {/* Transparent hit target for hover */}
                  <rect
                    x={isSingle ? pt.x - 20 : pt.x - plotWidth / (coords.length * 2)}
                    y={padTop}
                    width={isSingle ? 40 : plotWidth / coords.length}
                    height={plotHeight + 20}
                    fill="transparent"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredIndex(pt.index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  />
                </g>
              )
            })}
          </svg>

        {/* Hover Tooltip Overlay */}
        {activePoint && (
          <div
            className="perf-tooltip"
            style={{
              left: `${(activePoint.x / width) * 100}%`,
              top: `${Math.max(12, (activePoint.y / height) * 100 - 24)}%`,
            }}
            role="status"
            aria-live="polite"
          >
            <div className="perf-tooltip__time">{activePoint.time} {viewMode === 'hourly' ? 'Window' : 'Performance'}</div>
            <div className="perf-tooltip__row">
              <span className="perf-tooltip__indicator is-revenue" />
              <span className="perf-tooltip__key">Revenue:</span>
              <strong className="perf-tooltip__val">{formatINR(activePoint.revenue)}</strong>
            </div>
            <div className="perf-tooltip__row">
              <span className="perf-tooltip__indicator is-orders" />
              <span className="perf-tooltip__key">Orders:</span>
              <strong className="perf-tooltip__val">{activePoint.orders} completed</strong>
            </div>
            {activePoint.peak && (
              <div className="perf-tooltip__peak-badge">Peak Service Pacing</div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Accessible Screen-Reader Summary */}
      <div className="sr-only">
        <table>
          <caption>Performance Overview Data ({viewMode})</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Revenue</th>
              <th scope="col">Orders</th>
            </tr>
          </thead>
          <tbody>
            {isEmpty ? (
              <tr>
                <td colSpan={3}>No performance data available</td>
              </tr>
            ) : (
              activePoints.map(p => (
                <tr key={p.time}>
                  <td>{p.time}</td>
                  <td>{formatINR(p.revenue)}</td>
                  <td>{p.orders}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
